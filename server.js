require('dotenv').config();

const express = require('express');
const AWS = require('aws-sdk');
const cors = require('cors');
const compression = require('compression');
const xml2js = require('xml2js');
const zlib = require('zlib');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { query, validationResult } = require('express-validator');
const darwinKafka = require('./darwin-kafka');
const TIPLOC_DATABASE = require('./tiploc-database');
const dbService = require('./db');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Pass io to request object if needed, or just emit globally
io.on('connection', (socket) => {
    console.log('Client connected to WebSockets:', socket.id);
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

    // Initialize the database on startup
dbService.init();

if (require.main === module) {
    // Wait until variables are hoisted/defined
    setTimeout(() => {
        // Poll S3 automatically and broadcast to clients
        setInterval(async () => {
            await pollS3AndEmit();
        }, 60000); // 60 seconds
        
        // Initial poll
        pollS3AndEmit();
    }, 1000);
}

// Function to handle the background fetch, cache and WS emit
async function pollS3AndEmit() {
    try {
        console.log('🔄 Automatic S3 background poll...');
        const { jsonData, latestFileKey } = await fetchLatestTimetableJson();
        if (latestFileKey) {
            const trains = parseTrainData(jsonData);
            const enrichedTrains = enrichTrainsWithPushPort(trains);
            const validatedTrains = enrichedTrains.filter(validateTrainRecord);

            // Async persistence
            setImmediate(() => {
                dbService.saveTrainData(validatedTrains);
            });

            const response = { trains: validatedTrains, timestamp: new Date() };

            lastKnownGoodTrainResponse = {
                data: response,
                timestamp: Date.now()
            };
            
            // This will broadcast to WS
            setCachedTrainData(response);
        }
    } catch (error) {
        console.error('❌ Background S3 poll error:', error.message);
        
        const hasFallback = lastKnownGoodTrainResponse.data &&
            lastKnownGoodTrainResponse.timestamp &&
            (Date.now() - lastKnownGoodTrainResponse.timestamp) < FALLBACK_TTL;
            
        if (hasFallback) {
            console.log('⚠️ Emitting stale in-memory fallback data to clients via WS');
            io.emit('trains', {
                ...lastKnownGoodTrainResponse.data,
                stale: true,
                error: 'Using last known data due to upstream error'
            });
        } else {
            try {
                const dbFallbacks = dbService.getLatestTrainPositions();
                if (dbFallbacks && dbFallbacks.length > 0) {
                    console.log('⚠️ Emitting historical SQLite fallback data to clients via WS');
                    io.emit('trains', {
                        trains: dbFallbacks,
                        timestamp: new Date().toISOString(),
                        stale: true,
                        error: 'Using historical database data due to S3 crash'
                    });
                }
            } catch (dbErr) {
                console.error('❌ Database fallback lookup failed:', dbErr.message);
            }
        }
    }
}

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false // Disable for Leaflet maps
}));

// Compression middleware
app.use(compression({ threshold: 1024 }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// CORS and static files
app.use(cors());
app.use(express.static('./'));

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function s3RequestWithRetry(action, params, attempts = 3) {
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            return await s3[action](params).promise();
        } catch (error) {
            if (attempt === attempts - 1) {
                throw error;
            }
            const delay = 500 * Math.pow(2, attempt);
            console.warn(`⚠️  S3 ${action} failed (attempt ${attempt + 1}/${attempts}):`, error.message);
            await sleep(delay);
        }
    }
    return null;
}

// Validate required environment variables
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('❌ ERROR: AWS credentials not found in environment variables');
    console.error('Please create a .env file with:');
    console.error('  AWS_ACCESS_KEY_ID=your_access_key');
    console.error('  AWS_SECRET_ACCESS_KEY=your_secret_key');
    console.error('  AWS_REGION=eu-west-1');
    process.exit(1);
}

// AWS S3 Configuration
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'eu-west-1'
});

const xmlParser = new xml2js.Parser();

function normalizeToArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
    const parts = timeStr.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

function getPrimaryTime(attrs = {}) {
    return attrs.wtd || attrs.ptd || attrs.wta || attrs.pta || attrs.wtp || attrs.ptp || null;
}

// ============================================
// CACHING MECHANISM
// ============================================
let trainDataCache = {
    data: null,
    timestamp: null,
    ttl: parseInt(process.env.CACHE_TTL) || 30000 // 30 seconds - positions need frequent updates
};

let timetableCache = {
    data: null,
    fileKey: null,
    timestamp: null,
    ttl: parseInt(process.env.CACHE_TTL) || 30000
};

let lastKnownGoodTrainResponse = {
    data: null,
    timestamp: null
};

const FALLBACK_TTL = parseInt(process.env.FALLBACK_TTL) || 24 * 60 * 60 * 1000; // 24 hours fallback limit

function getCachedTrainData() {
    if (trainDataCache.data && 
        trainDataCache.timestamp && 
        (Date.now() - trainDataCache.timestamp) < trainDataCache.ttl) {
        console.log('✅ Returning cached train data');
        return trainDataCache.data;
    }
    return null;
}

function setCachedTrainData(data) {
    trainDataCache.data = data;
    trainDataCache.timestamp = Date.now();
    console.log('💾 Train data cached');
    io.emit('trains', data); // Push updates via WebSockets
}

function getCachedTimetableData() {
    if (timetableCache.data &&
        timetableCache.timestamp &&
        (Date.now() - timetableCache.timestamp) < timetableCache.ttl) {
        console.log('✅ Returning cached timetable data');
        return timetableCache;
    }
    return null;
}

function setCachedTimetableData(data, fileKey) {
    timetableCache.data = data;
    timetableCache.fileKey = fileKey;
    timetableCache.timestamp = Date.now();
    console.log('💾 Timetable data cached');
}

async function fetchLatestTimetableJson() {
    const cachedTimetable = getCachedTimetableData();
    if (cachedTimetable) {
        return {
            jsonData: cachedTimetable.data,
            latestFileKey: cachedTimetable.fileKey
        };
    }

    const params = {
        Bucket: 'darwin.xmltimetable',
        Prefix: 'PPTimetable/'
    };

    console.log('📂 Listing S3 bucket files with prefix:', params.Prefix);
    const listResponse = await s3RequestWithRetry('listObjectsV2', params);
    const files = listResponse.Contents || [];

    console.log('📊 S3 Files found:', files.length);

    if (files.length === 0) {
        return {
            jsonData: { PportTimetable: { Journey: [] } },
            latestFileKey: null
        };
    }

    const latestFile = files.sort((a, b) =>
        new Date(b.LastModified) - new Date(a.LastModified)
    )[0];

    console.log('📄 Latest file:', latestFile.Key, '- Size:', latestFile.Size, 'bytes');

    const fileResponse = await s3RequestWithRetry('getObject', {
        Bucket: 'darwin.xmltimetable',
        Key: latestFile.Key
    });

    const compressedData = fileResponse.Body;
    console.log('📥 Compressed data received - Length:', compressedData.length, 'bytes');
    console.log('🔓 Decompressing gzip file...');

    const xmlData = await new Promise((resolve, reject) => {
        zlib.gunzip(compressedData, (err, decompressed) => {
            if (err) reject(err);
            else resolve(decompressed.toString('utf-8'));
        });
    });

    console.log('✅ Decompression successful');
    console.log('📝 XML Data length:', xmlData.length, 'bytes');
    console.log('📝 First 500 characters:', xmlData.substring(0, 500));

    const jsonData = await xmlParser.parseStringPromise(xmlData);
    setCachedTimetableData(jsonData, latestFile.Key);

    return {
        jsonData,
        latestFileKey: latestFile.Key
    };
}

// ============================================
// HEALTH CHECK ENDPOINT
// ============================================
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        awsConfigured: !!process.env.AWS_ACCESS_KEY_ID 
    });
});

// ============================================
// GET LIVE TRAINS FROM DARWIN TIMETABLE
// ============================================
app.get('/api/trains', [
    query('station').optional().isString().matches(/^[A-Z0-9]{3}$/i).withMessage('Invalid station code format')
], async (req, res) => {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    // Check cache first
    const cachedData = getCachedTrainData();
    if (cachedData) {
        return res.json(cachedData);
    }
    
    try {
        const { jsonData, latestFileKey } = await fetchLatestTimetableJson();

        if (!latestFileKey) {
            console.log('⚠️  No files found in S3 bucket');
            return res.json({ trains: [] });
        }

        // Extract train information (structure depends on Darwin XML format)
        const trains = parseTrainData(jsonData);
        
        console.log('🚆 Darwin API Response:');
        console.log('- File:', latestFileKey);
        console.log('- Trains parsed:', trains.length);
        console.log('- Train data:', JSON.stringify(trains, null, 2));

        // Enrich trains with unit numbers from Push Port live feed
        const enrichedTrains = enrichTrainsWithPushPort(trains);
        const validatedTrains = enrichedTrains.filter(validateTrainRecord);

        // Async persistence so we don't block the HTTP response
        setImmediate(() => {
            dbService.saveTrainData(validatedTrains);
        });

        const response = { trains: validatedTrains, timestamp: new Date() };
        lastKnownGoodTrainResponse = {
            data: response,
            timestamp: Date.now()
        };
        setCachedTrainData(response);
        res.json(response);
    } catch (error) {
        console.error('❌ Error fetching trains from S3:', error.message);
        console.error('Full error:', error);
        
        const hasFallback = lastKnownGoodTrainResponse.data &&
            lastKnownGoodTrainResponse.timestamp &&
            (Date.now() - lastKnownGoodTrainResponse.timestamp) < FALLBACK_TTL;
            
        if (hasFallback) {
            return res.json({
                ...lastKnownGoodTrainResponse.data,
                stale: true,
                error: 'Using last known data due to upstream error'
            });
        } else {
            // Attempt to load from database if memory cache is gone or expired
            try {
                const dbFallbacks = dbService.getLatestTrainPositions();
                if (dbFallbacks && dbFallbacks.length > 0) {
                    console.log(`⚠️  Using ${dbFallbacks.length} historical records from SQLite fallback`);
                    return res.json({
                        trains: dbFallbacks,
                        timestamp: new Date().toISOString(),
                        stale: true,
                        error: 'Using historical database data due to upstream S3 crash'
                    });
                }
            } catch (dbErr) {
                console.error('❌ Database fallback failed:', dbErr.message);
            }
        }
        res.status(500).json({ error: 'Failed to fetch train data', message: error.message });
    }
});

// ============================================
// PARSE DARWIN XML TO TRAIN OBJECTS
// (Only returns trains currently running right now)
// ============================================
function parseTrainData(xmlJson) {
    const trains = [];
    
    try {
        console.log('🔍 Starting to parse train data...');
        
        const now = new Date();
        const todayStr = now.toISOString().slice(0, 10); // "YYYY-MM-DD"
        const todayCompact = todayStr.replace(/-/g, ''); // "YYYYMMDD"
        const nowMinutes = now.getHours() * 60 + now.getMinutes(); // minutes since midnight
        
        console.log(`🕐 Current time: ${now.toTimeString().slice(0,5)}, today: ${todayStr}, nowMinutes: ${nowMinutes}`);
        
        // Navigate through the XML structure
        // Root element is PportTimetable
        const timetable = xmlJson.PportTimetable || xmlJson.Timetable || xmlJson.timetable || {};
        console.log('📦 Timetable keys:', Object.keys(timetable));
        
        const journeys = timetable.Journey || [];
        console.log('📋 Found journeys:', journeys.length);
        
        let skippedDate = 0;
        let skippedNotStarted = 0;
        let skippedFinished = 0;
        let skippedNonPassenger = 0;

        journeys.forEach((journey, index) => {
            try {
                const attrs = journey.$ || {};
                
                // --- Filter 1: Only today's services ---
                const serviceDate = (attrs.ssd || '').trim();
                const normalizedServiceDate = serviceDate.includes('-')
                    ? serviceDate
                    : serviceDate.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
                if (serviceDate && normalizedServiceDate !== todayStr && serviceDate !== todayCompact) {
                    skippedDate++;
                    return;
                }
                
                // --- Filter 2: Only passenger services ---
                if (attrs.isPassengerSvc === 'false') {
                    skippedNonPassenger++;
                    return;
                }
                
                // --- Extract scheduled times ---
                const origins = journey.OR || [];
                const destinations = journey.DT || [];
                
                // Get departure time from origin (wtd = working time departure)
                let departureTimeStr = null;
                if (origins.length > 0 && origins[0].$) {
                    departureTimeStr = origins[0].$.wtd || origins[0].$.ptd || null;
                }
                
                // Get arrival time at destination (wta = working time arrival)
                let arrivalTimeStr = null;
                if (destinations.length > 0 && destinations[0].$) {
                    arrivalTimeStr = destinations[0].$.wta || destinations[0].$.pta || null;
                }
                
                // Parse time string "HH:MM" or "HH:MM:SS" to minutes since midnight
                function parseTimeToMinutes(timeStr) {
                    if (!timeStr) return null;
                    const parts = timeStr.split(':');
                    return parseInt(parts[0]) * 60 + parseInt(parts[1]);
                }
                
                const depMinutes = parseTimeToMinutes(departureTimeStr);
                const arrMinutes = parseTimeToMinutes(arrivalTimeStr);
                
                // --- Filter 3: Keep upcoming services for search visibility ---
                if (depMinutes !== null && nowMinutes < depMinutes - 5) {
                    skippedNotStarted++;
                }
                
                // --- Build train object ---
                const trainId = attrs.rid || attrs.trainId || `TR${String(index).padStart(3, '0')}`;
                const trainName = attrs.trainId || 'Unknown Train';
                const uid = attrs.uid || '';
                
                const originCode = (origins.length > 0 && origins[0].$ && origins[0].$.tpl) || 'KGX';
                const destinationCode = (destinations.length > 0 && destinations[0].$ && destinations[0].$.tpl) || 'KGX';
                
                let originName = originCode;
                let destinationName = destinationCode;
                
                const originStation = getStationCoordinates(originCode);
                const destinationStation = getStationCoordinates(destinationCode);
                
                if (originStation.name !== 'Unknown Station') {
                    originName = originStation.name;
                }
                if (destinationStation.name !== 'Unknown Station') {
                    destinationName = destinationStation.name;
                }
                
                // Calculate position based on real time progress
                const positionData = getTrainPosition(originCode, destinationCode, depMinutes, arrMinutes, nowMinutes, journey);
                
                // Determine status
                let status = 'On Time';
                if (depMinutes !== null && nowMinutes < depMinutes) {
                    status = 'Not yet departed';
                } else if (arrMinutes !== null && nowMinutes >= arrMinutes) {
                    status = 'Arrived';
                } else {
                    status = 'En Route';
                }
                
                // Extract unit number
                let unitNumber = null;
                if (journey.Formations && journey.Formations.length > 0) {
                    const formation = journey.Formations[0];
                    if (formation.$ && formation.$.fid) {
                        unitNumber = formation.$.fid;
                    }
                }

                trains.push({
                    id: trainId,
                    name: trainName,
                    lat: positionData.lat,
                    lng: positionData.lng,
                    station: originName,
                    destination: destinationName,
                    originCode: originCode,
                    destinationCode: destinationCode,
                    uid: uid,
                    unitNumber: unitNumber,
                    operator: attrs.toc || 'Unknown Operator',
                    status: status,
                    departureTime: departureTimeStr,
                    arrivalTime: arrivalTimeStr,
                    progress: positionData.progress
                });
            } catch (err) {
                console.warn('⚠️  Error parsing individual journey:', err.message);
            }
        });
        
        console.log(`✅ Parsed ${trains.length} same-day trains`);
        console.log(`   Skipped: ${skippedDate} wrong date, ${skippedNonPassenger} non-passenger, ${skippedNotStarted} not started`);
    } catch (error) {
        console.warn('⚠️  Could not parse full Darwin data:', error.message);
    }

    return trains;
}

// ============================================
// VALIDATE TRAIN RECORD
// ============================================
function validateTrainRecord(train) {
    if (!train || !train.id) return false;
    if (!Number.isFinite(train.lat) || !Number.isFinite(train.lng)) return false;
    if (train.lat < 49 || train.lat > 61) return false;
    if (train.lng < -8 || train.lng > 2) return false;
    return true;
}

// ============================================
// UK RAILWAY STATION DATABASE WITH COORDINATES
// Uses comprehensive TIPLOC database from tiploc-database.js
// ============================================
const STATION_DATABASE = TIPLOC_DATABASE;

// Legacy CRS code aliases (kept for backwards compatibility)
const LEGACY_CRS_CODES = {
    'KGX': { name: 'London King\'s Cross', lat: 51.5307, lng: -0.1234 },
    'KNGX': { name: 'London King\'s Cross', lat: 51.5307, lng: -0.1234 },
    'STP': { name: 'London St Pancras', lat: 51.5330, lng: -0.1254 },
    'LST': { name: 'London Liverpool Street', lat: 51.5174, lng: -0.0821 },
    'LIVST': { name: 'London Liverpool Street', lat: 51.5174, lng: -0.0821 },
    'MOG': { name: 'Moorgate', lat: 51.5200, lng: -0.0952 },
    'FST': { name: 'Farringdon', lat: 51.5180, lng: -0.1050 },
    'PAD': { name: 'London Paddington', lat: 51.5156, lng: -0.1753 },
    'VXH': { name: 'Victoria', lat: 51.4927, lng: -0.1449 },
    'VICTRIC': { name: 'Victoria', lat: 51.4927, lng: -0.1449 },
    'LBG': { name: 'London Bridge', lat: 51.5048, lng: -0.0862 },
    'WAT': { name: 'Waterloo', lat: 51.5034, lng: -0.1124 },
    'CHR': { name: 'Charing Cross', lat: 51.5082, lng: -0.1236 },
    'CTL': { name: 'Cannon Street', lat: 51.5104, lng: -0.0775 },
    'FSH': { name: 'Fenchurch Street', lat: 51.5149, lng: -0.0753 },
    'EPHT': { name: 'Elephant & Castle', lat: 51.4944, lng: -0.1002 },
    'EPH': { name: 'Elephant & Castle', lat: 51.4944, lng: -0.1002 },
    'SHENFLD': { name: 'Shenfield', lat: 51.6297, lng: 0.3291 },
    'CORYTON': { name: 'Coryton', lat: 51.5459, lng: 0.5152 },
    'CMTHN': { name: 'Cheshunt', lat: 51.7030, lng: -0.0289 },
    'HERTFDE': { name: 'Hertford East', lat: 51.7957, lng: -0.0810 },
    'KLYNN': { name: 'King\'s Lynn', lat: 52.7534, lng: 0.4121 },
    'EPSM': { name: 'Epsom', lat: 51.3371, lng: -0.2513 },
    'CRPHLY': { name: 'Carshalton', lat: 51.3644, lng: -0.1679 },
    'FGDHBR': { name: 'Finsbury Park', lat: 51.5648, lng: -0.1063 },
    'ABWDXR': { name: 'Aberystwyth', lat: 52.4182, lng: -4.0843 },
    'RDNGSTN': { name: 'Reading', lat: 51.4576, lng: -0.9715 },
    'LEEDS': { name: 'Leeds City Station', lat: 53.7949, lng: -1.6477 },
    'DONC': { name: 'Doncaster', lat: 53.5178, lng: -1.1391 },
    'EDINAIR': { name: 'Edinburgh Airport', lat: 55.9486, lng: -3.3725 },
    'BAROW': { name: 'Barrow-in-Furness', lat: 54.1199, lng: -3.2294 },
    'CRCK': { name: 'Carrick-on-Shannon', lat: 53.9405, lng: -8.0892 },
    'INVURIE': { name: 'Inverurie', lat: 57.2817, lng: -2.3779 },
    'HNTL': { name: 'Huntly', lat: 57.4459, lng: -2.7829 },
    'RHYMNEY': { name: 'Rhymney', lat: 51.7582, lng: -3.2845 },
    
    // Additional TIPLOC codes for major stations
    'HLYH': { name: 'Holyhead', lat: 53.3091, lng: -4.6338 },
    'HHD': { name: 'Holyhead', lat: 53.3091, lng: -4.6338 },
    'IPSWICH': { name: 'Ipswich', lat: 52.0564, lng: 1.1481 },
    'NRCH': { name: 'Norwich', lat: 52.6281, lng: 1.2986 },
    'PADTON': { name: 'London Paddington', lat: 51.5156, lng: -0.1753 },
    'CHST': { name: 'Chesterfield', lat: 53.2375, lng: -1.4221 },
    'GLGC': { name: 'Glasgow Central', lat: 55.8642, lng: -4.2592 },
    'WSTBRYW': { name: 'Westbury', lat: 51.2602, lng: -2.1866 },
    'LTLHMPT': { name: 'Littlehampton', lat: 50.8090, lng: -0.5415 },
    'LESTER': { name: 'Leicester', lat: 52.6205, lng: -1.1424 },
    'REDCARC': { name: 'Redcar Central', lat: 54.6176, lng: -1.0724 },
    'ELYY': { name: 'Ely', lat: 52.3988, lng: 0.2623 },
    'EUSTON': { name: 'London Euston', lat: 51.5282, lng: -0.1337 },
    'EKILBRD': { name: 'East Kilbride', lat: 55.7649, lng: -4.1773 },
    'MNCRIAP': { name: 'Manchester Airport', lat: 53.3649, lng: -2.2730 },
    'EDINBUR': { name: 'Edinburgh', lat: 55.9545, lng: -3.1887 },
    'WITHAME': { name: 'Witham', lat: 51.8009, lng: 0.6392 },
    'STRBDGT': { name: 'Stirling', lat: 56.1248, lng: -3.9386 },
    'STRBDG1': { name: 'Stirling', lat: 56.1248, lng: -3.9386 },
    'BHAMNWS': { name: 'Birmingham New Street', lat: 52.5079, lng: -1.9038 },
    'CLCHRTN': { name: 'Clacton-on-Sea', lat: 51.7893, lng: 1.1542 },
    'LVRPLSH': { name: 'Liverpool Lime Street', lat: 53.4073, lng: -2.9616 },
    'GLOSTER': { name: 'Gloucester', lat: 51.8679, lng: -2.2384 },
    'CARLILE': { name: 'Carlisle', lat: 54.8929, lng: -2.9375 },
    'WVRMPTN': { name: 'Wolverhampton', lat: 52.5860, lng: -2.1298 },
    'HTRWTM5': { name: 'Heathrow Terminal 5', lat: 51.4712, lng: -0.4883 },
    'PERTH': { name: 'Perth', lat: 56.4010, lng: -3.3999 },
    
    // Major Regional Hubs
    'BHM': { name: 'Birmingham New Street', lat: 52.5079, lng: -1.9038 },
    'BMO': { name: 'Birmingham Moor Street', lat: 52.5067, lng: -1.8987 },
    'MAN': { name: 'Manchester Piccadilly', lat: 53.4779, lng: -2.2298 },
    'MCV': { name: 'Manchester Victoria', lat: 53.4878, lng: -2.2355 },
    'SDF': { name: 'Stockport', lat: 53.4084, lng: -2.1659 },
    'LIV': { name: 'Liverpool Lime Street', lat: 53.4073, lng: -2.9616 },
    'EDB': { name: 'Edinburgh Waverley', lat: 55.9545, lng: -3.1887 },
    'GLC': { name: 'Glasgow Central', lat: 55.8642, lng: -4.2592 },
    'GQU': { name: 'Glasgow Queen Street', lat: 55.8609, lng: -4.2589 },
    'PRE': { name: 'Perth', lat: 56.4010, lng: -3.3999 },
    'ABD': { name: 'Aberdeen', lat: 57.1427, lng: -2.0848 },
    'IVR': { name: 'Inverness', lat: 57.4779, lng: -4.2247 },
    
    // South West
    'BRI': { name: 'Bristol Temple Meads', lat: 51.4387, lng: -2.5821 },
    'BAT': { name: 'Bath Spa', lat: 51.3844, lng: -2.3609 },
    'EXD': { name: 'Exeter St David\'s', lat: 50.7184, lng: -3.5339 },
    'PLY': { name: 'Plymouth', lat: 50.3650, lng: -4.1416 },
    'TON': { name: 'Totnes', lat: 50.4605, lng: -3.6819 },
    'TRU': { name: 'Truro', lat: 50.2633, lng: -4.9976 },
    'PNZ': { name: 'Penzance', lat: 50.1180, lng: -5.5308 },
    
    // South Coast
    'CHI': { name: 'Chichester', lat: 50.8353, lng: -0.7814 },
    'POR': { name: 'Portsmouth Harbour', lat: 50.8014, lng: -1.1147 },
    'SAL': { name: 'Salisbury', lat: 51.0694, lng: -1.7941 },
    
    // West Midlands & Wales
    'CDF': { name: 'Cardiff Central', lat: 51.4761, lng: -3.1761 },
    'SWA': { name: 'Swansea', lat: 51.6186, lng: -3.9413 },
    'BAN': { name: 'Bangor', lat: 53.2281, lng: -4.1277 },
    'CVT': { name: 'Coventry', lat: 52.3889, lng: -1.5126 },
    'WLV': { name: 'Wolverhampton', lat: 52.5860, lng: -2.1298 },
    
    // East Midlands & East Anglia
    'LEI': { name: 'Leicester', lat: 52.6205, lng: -1.1424 },
    'NRW': { name: 'Northampton', lat: 52.2354, lng: -0.8921 },
    'PET': { name: 'Peterborough', lat: 52.5675, lng: -0.2444 },
    'NRY': { name: 'Norwich', lat: 52.6281, lng: 1.2986 },
    'GRP': { name: 'Great Yarmouth', lat: 52.6143, lng: 1.7303 },
    'CBG': { name: 'Cambridge', lat: 52.1940, lng: 0.1427 },
    
    // Yorkshire
    'LDS': { name: 'Leeds City Station', lat: 53.7949, lng: -1.6477 },
    'YRK': { name: 'York', lat: 53.9577, lng: -1.0873 },
    'HDR': { name: 'Huddersfield', lat: 53.6464, lng: -1.8787 },
    'HFX': { name: 'Halifax', lat: 53.7168, lng: -1.8774 },
    'BRD': { name: 'Bradford Interchange', lat: 53.7936, lng: -1.7526 },
    'WHF': { name: 'Wakefield Westgate', lat: 53.6833, lng: -1.5018 },
    'DNH': { name: 'Doncaster', lat: 53.5178, lng: -1.1391 },
    'SHF': { name: 'Sheffield', lat: 53.3714, lng: -1.4634 },
    
    // North East
    'NCL': { name: 'Newcastle Central', lat: 54.9687, lng: -1.6218 },
    'DHM': { name: 'Durham', lat: 54.7779, lng: -1.5760 },
    'MID': { name: 'Middlesbrough', lat: 54.5744, lng: -1.2378 },
    
    // North West and Scotland
    'CRL': { name: 'Carlisle', lat: 54.8929, lng: -2.9375 },
    'DMF': { name: 'Dumfries', lat: 55.0764, lng: -3.5913 },
    'AYR': { name: 'Ayr', lat: 55.4606, lng: -4.6320 },
    'STG': { name: 'Stirling', lat: 56.1248, lng: -3.9386 },
    'DUE': { name: 'Dundee', lat: 56.4574, lng: -2.9703 },
    'KLP': { name: 'Kirkcaldy', lat: 56.1167, lng: -3.1744 }
};

// Merge legacy CRS codes into the main database (TIPLOC DB takes priority)
for (const [code, data] of Object.entries(LEGACY_CRS_CODES)) {
    if (!STATION_DATABASE[code]) {
        STATION_DATABASE[code] = data;
    }
}

// ============================================
// HELPER: Get station coordinates from database
// ============================================
function getStationCoordinates(stationCode) {
    // Look up in TIPLOC database first
    if (stationCode && STATION_DATABASE[stationCode]) {
        return STATION_DATABASE[stationCode];
    }
    
    // Try uppercase lookup
    if (stationCode && STATION_DATABASE[stationCode.toUpperCase()]) {
        return STATION_DATABASE[stationCode.toUpperCase()];
    }
    
    // Default to London if station not found
    console.warn(`⚠️  Station/TIPLOC code "${stationCode}" not found in database`);
    return { name: stationCode || 'Unknown Station', lat: 51.5307, lng: -0.1234 };
}

// ============================================
// HELPER: Interpolate train position between origin and destination
// Uses scheduled times + intermediate calling points for realistic positioning
// ============================================
function getTrainPosition(originCode, destinationCode, depMinutes, arrMinutes, nowMinutes, journey) {
    const origin = getStationCoordinates(originCode);
    const destination = getStationCoordinates(destinationCode);
    
    // Calculate time-based progress (0.0 = at origin, 1.0 = at destination)
    let progress = 0.5; // default if times missing
    
    if (depMinutes !== null && arrMinutes !== null && arrMinutes > depMinutes) {
        const totalDuration = arrMinutes - depMinutes;
        const elapsed = nowMinutes - depMinutes;
        progress = Math.max(0, Math.min(1, elapsed / totalDuration));
    } else if (depMinutes !== null && arrMinutes !== null && arrMinutes <= depMinutes) {
        // Overnight service (crosses midnight)
        const totalDuration = (1440 - depMinutes) + arrMinutes;
        const elapsed = nowMinutes >= depMinutes 
            ? nowMinutes - depMinutes 
            : (1440 - depMinutes) + nowMinutes;
        progress = Math.max(0, Math.min(1, elapsed / totalDuration));
    }
    
    // Try to use intermediate calling points (IP elements) for more accurate routing
    if (journey) {
        const callingPoints = [];
        
        // Origin
        callingPoints.push({ code: originCode, minutes: depMinutes });
        
        // Intermediate points (IP = intermediate point with stop)
        const intermediates = journey.IP || [];
        intermediates.forEach(ip => {
            if (ip.$ && ip.$.tpl) {
                const timeStr = ip.$.wta || ip.$.pta || ip.$.wtd || ip.$.ptd;
                if (timeStr) {
                    const parts = timeStr.split(':');
                    const mins = parseInt(parts[0]) * 60 + parseInt(parts[1]);
                    callingPoints.push({ code: ip.$.tpl, minutes: mins });
                }
            }
        });
        
        // Destination
        callingPoints.push({ code: destinationCode, minutes: arrMinutes });
        
        // Find which segment we're in based on current time
        if (callingPoints.length >= 2 && depMinutes !== null && arrMinutes !== null) {
            for (let i = 0; i < callingPoints.length - 1; i++) {
                const from = callingPoints[i];
                const to = callingPoints[i + 1];
                if (from.minutes !== null && to.minutes !== null && 
                    nowMinutes >= from.minutes && nowMinutes <= to.minutes) {
                    const fromStation = getStationCoordinates(from.code);
                    const toStation = getStationCoordinates(to.code);
                    const segDuration = to.minutes - from.minutes;
                    const segElapsed = nowMinutes - from.minutes;
                    const segProgress = segDuration > 0 ? segElapsed / segDuration : 0.5;
                    
                    return {
                        lat: parseFloat((fromStation.lat + (toStation.lat - fromStation.lat) * segProgress).toFixed(4)),
                        lng: parseFloat((fromStation.lng + (toStation.lng - fromStation.lng) * segProgress).toFixed(4)),
                        progress: Math.round(progress * 100)
                    };
                }
            }
        }
    }
    
    // Fallback: linear interpolation between origin and destination
    const lat = origin.lat + (destination.lat - origin.lat) * progress;
    const lng = origin.lng + (destination.lng - origin.lng) * progress;
    
    return {
        lat: parseFloat(lat.toFixed(4)),
        lng: parseFloat(lng.toFixed(4)),
        progress: Math.round(progress * 100)
    };
}

function getJourneyStops(journey) {
    const stops = [];

    const originPoints = normalizeToArray(journey.OR);
    const operationalOrigins = normalizeToArray(journey.OPOR);
    const destinationPoints = normalizeToArray(journey.DT);
    const operationalDestinations = normalizeToArray(journey.OPDT);
    const callingPoints = normalizeToArray(journey.IP);

    const origins = originPoints.length ? originPoints : operationalOrigins;
    const destinations = destinationPoints.length ? destinationPoints : operationalDestinations;

    const addPoint = (point, type) => {
        const attrs = point.$ || {};
        const code = attrs.tpl || null;
        const station = getStationCoordinates(code);
        const fallbackName = attrs.locname || attrs.locName || attrs.tiploc || null;
        const name = (station.name === code && fallbackName) ? fallbackName : (station.name || code || 'Unknown Station');

        stops.push({
            code,
            name,
            time: getPrimaryTime(attrs),
            scheduledArrival: attrs.wta || attrs.pta || null,
            scheduledDeparture: attrs.wtd || attrs.ptd || null,
            passTime: attrs.wtp || attrs.ptp || null,
            platform: attrs.plat || null,
            type
        });
    };

    origins.forEach(point => addPoint(point, 'Origin'));
    callingPoints.forEach(point => addPoint(point, 'Calling point'));
    destinations.forEach(point => addPoint(point, 'Destination'));

    return stops;
}

function getJourneyUnitNumbers(journey, attrs) {
    const numbers = new Set();
    const rid = attrs.rid || null;
    const trainId = attrs.trainId || null;
    const uid = attrs.uid || null;

    // Include timetable formation unit numbers when present.
    if (journey.Formations && journey.Formations.length > 0) {
        const formation = journey.Formations[0];
        if (formation?.$?.fid) {
            formation.$.fid.split('+').forEach(unit => numbers.add(unit));
        }
    }

    const pushPortTrain = darwinKafka.getLiveTrainsWithFormations().find(train =>
        (rid && train.rid === rid) ||
        (trainId && train.trainId === trainId) ||
        (uid && train.uid === uid)
    );
    if (pushPortTrain?.formation?.unitNumbers?.length) {
        pushPortTrain.formation.unitNumbers.forEach(unit => numbers.add(unit));
    }
    if (pushPortTrain?.unitNumber) {
        pushPortTrain.unitNumber.split('+').forEach(unit => numbers.add(unit));
    }

    return Array.from(numbers).filter(Boolean);
}

function buildTrainDetail(journey) {
    const attrs = journey.$ || {};
    const origins = normalizeToArray(journey.OR);
    const operationalOrigins = normalizeToArray(journey.OPOR);
    const startPoint = origins[0] || operationalOrigins[0] || null;
    const startAttrs = startPoint?.$ || {};
    const stops = getJourneyStops(journey);
    const unitNumbers = getJourneyUnitNumbers(journey, attrs);

    const rid = attrs.rid || null;
    const trainId = attrs.trainId || null;
    const uid = attrs.uid || null;
    const pushPortTrain = darwinKafka.getLiveTrainsWithFormations().find(train =>
        (rid && train.rid === rid) ||
        (trainId && train.trainId === trainId) ||
        (uid && train.uid === uid)
    ) || {};

    return {
        trainId: rid || pushPortTrain.rid || null,
        headcode: attrs.trainId || pushPortTrain.trainId || attrs.rid || pushPortTrain.rid || null,
        uid: attrs.uid || pushPortTrain.uid || null,
        serviceDate: attrs.ssd || null,
        operator: attrs.toc || pushPortTrain.toc || null,
        startTime: getPrimaryTime(startAttrs),
        unitNumbers,
        unitNumber: unitNumbers.join('+') || pushPortTrain.unitNumber || null,
        origin: stops[0] || null,
        destination: stops[stops.length - 1] || null,
        stations: stops
    };
}

app.get('/api/trains/:rid/details', async (req, res) => {
    try {
        const requestedRid = req.params.rid;
        const { jsonData } = await fetchLatestTimetableJson();
        const timetable = jsonData.PportTimetable || jsonData.Timetable || jsonData.timetable || {};
        const journeys = normalizeToArray(timetable.Journey);

        const journey = journeys.find(item => {
            const attrs = item.$ || {};
            return attrs.rid === requestedRid || attrs.trainId === requestedRid || attrs.uid === requestedRid;
        });

        if (!journey) {
            // Try Push Port memory
            const pushPortTrain = darwinKafka.getLiveTrainsWithFormations().find(train => 
                train.rid === requestedRid || train.trainId === requestedRid || train.uid === requestedRid
            );
            if (!pushPortTrain) {
                return res.status(404).json({ error: 'Train not found' });
            }
            return res.json({
                trainId: pushPortTrain.rid || null,
                headcode: pushPortTrain.trainId || pushPortTrain.rid || null,
                uid: pushPortTrain.uid || null,
                serviceDate: null,
                operator: pushPortTrain.toc || null,
                startTime: null,
                unitNumbers: pushPortTrain.formation?.unitNumbers || [],
                unitNumber: pushPortTrain.unitNumber || null,
                origin: { name: pushPortTrain.originTiploc },
                destination: { name: pushPortTrain.destinationTiploc },
                stations: []
            });
        }

        res.json(buildTrainDetail(journey));
    } catch (error) {
        console.error('❌ Error fetching train details:', error.message);
        res.status(500).json({ error: 'Failed to fetch train details', message: error.message });
    }
});

// ============================================
// GET STATIONS REFERENCE DATA
// ============================================
app.get('/api/stations', async (req, res) => {
    try {
        const stations = [
            { name: 'London King\'s Cross', code: 'KGX', lat: 51.5307, lng: -0.1234 },
            { name: 'London St Pancras', code: 'STP', lat: 51.5330, lng: -0.1254 },
            { name: 'Birmingham New Street', code: 'BHM', lat: 52.5079, lng: -1.9038 },
            { name: 'Manchester Piccadilly', code: 'MAN', lat: 53.4779, lng: -2.2298 },
            { name: 'Liverpool Lime Street', code: 'LIV', lat: 53.4073, lng: -2.9616 },
            { name: 'Edinburgh Waverley', code: 'EDB', lat: 55.9545, lng: -3.1887 },
            { name: 'Glasgow Central', code: 'GLC', lat: 55.8642, lng: -4.2592 },
            { name: 'Bristol Temple Meads', code: 'BRI', lat: 51.4387, lng: -2.5821 },
            { name: 'Cardiff Central', code: 'CDF', lat: 51.4761, lng: -3.1761 },
            { name: 'Leeds City Station', code: 'LDS', lat: 53.7949, lng: -1.6477 },
            { name: 'Newcastle Central', code: 'NCL', lat: 54.9687, lng: -1.6218 },
            { name: 'Plymouth', code: 'PLY', lat: 50.3650, lng: -4.1416 },
            { name: 'Exeter St David\'s', code: 'EXD', lat: 50.7184, lng: -3.5339 },
            { name: 'Bath Spa', code: 'BAT', lat: 51.3844, lng: -2.3609 }
        ];
        res.json(stations);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stations' });
    }
});

// ============================================
// ENRICH TIMETABLE TRAINS WITH PUSH PORT DATA
// ============================================
function enrichTrainsWithPushPort(trains) {
    const pushPortTrains = darwinKafka.getLiveTrainsWithFormations();
    
    // Build lookup maps from Push Port data
    const ridMap = new Map();     // RID -> push port train
    const trainIdMap = new Map(); // headcode -> push port train
    const uidMap = new Map();     // UID -> push port train

    function normalizeHeadcode(value) {
        if (!value) return null;
        return String(value).trim().toUpperCase();
    }

    function isHeadcode(value) {
        return /^[0-9][A-Z][0-9]{2}$/.test(value);
    }
    
    for (const ppTrain of pushPortTrains) {
        if (ppTrain.rid) ridMap.set(ppTrain.rid, ppTrain);
        const normalizedTrainId = normalizeHeadcode(ppTrain.trainId);
        if (normalizedTrainId && isHeadcode(normalizedTrainId)) {
            trainIdMap.set(normalizedTrainId, ppTrain);
        }
        if (ppTrain.uid) uidMap.set(ppTrain.uid, ppTrain);
    }
    
    return trains.map(train => {
        const normalizedName = normalizeHeadcode(train.name);
        const normalizedId = normalizeHeadcode(train.id);

        // Try matching by RID first, then headcode (trainId), then UID
        const ppMatch = ridMap.get(train.id) || 
                        (normalizedName && isHeadcode(normalizedName) ? trainIdMap.get(normalizedName) : null) || 
                        (normalizedId && isHeadcode(normalizedId) ? trainIdMap.get(normalizedId) : null) || 
                        uidMap.get(train.uid);
        
        if (ppMatch) {
            return {
                ...train,
                unitNumber: ppMatch.unitNumber || train.unitNumber,
                formation: ppMatch.formation || null,
                lateReason: ppMatch.lateReason || null,
                toc: ppMatch.toc || train.operator,
                // Update status from live data
                status: ppMatch.lateReason ? 'Delayed' : (train.status || 'On Time')
            };
        }
        return train;
    });
}

// ============================================
// PUSH PORT LIVE TRAINS ENDPOINT
// ============================================
app.get('/api/pushport/trains', (req, res) => {
    const trains = darwinKafka.getLiveTrainsWithFormations();
    res.json({
        trains,
        count: trains.length,
        timestamp: new Date()
    });
});

// ============================================
// PUSH PORT STATUS ENDPOINT
// ============================================
app.get('/api/pushport/status', (req, res) => {
    res.json(darwinKafka.getConsumerStatus());
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

async function shutdown() {
    console.log('\n🛑 Shutting down gracefully...');
    await darwinKafka.stopDarwinConsumer();
    if (server) {
        server.close(() => {
            console.log('✅ Server closed');
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;
if (require.main === module) {
    server.listen(PORT, async () => {
        console.log(`🚂 Railway Radar server running on http://localhost:${PORT}`);
        console.log(`📡 API endpoints:`);
        console.log(`   - GET /api/trains`);
        console.log(`   - GET /api/stations`);
        console.log(`   - GET /api/health`);
        console.log(`   - GET /api/pushport/trains`);
        console.log(`   - GET /api/pushport/status`);

        // Start Darwin Push Port Kafka consumer
        const kafkaStarted = await darwinKafka.startDarwinConsumer();
        if (kafkaStarted) {
            console.log('✅ Darwin Push Port live feed active - unit numbers will be available');
        } else {
            console.log('⚠️  Darwin Push Port not started - using timetable data only (no unit numbers)');
            console.log('   To enable: set KAFKA_API_KEY and KAFKA_API_SECRET in .env');
        }
    });
}

module.exports = app;

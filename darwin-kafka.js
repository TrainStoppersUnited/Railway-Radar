/**
 * Darwin Push Port - Kafka Consumer
 * 
 * Connects to the National Rail Darwin Push Port feed via Confluent Cloud Kafka.
 * Receives real-time train status updates including formation/unit number data.
 * 
 * Messages are XML (Darwin Push Port v16 schema) containing:
 *   - Train Status (TS) messages with real-time updates
 *   - Formation data with unit/coach information
 *   - Schedule updates, associations, etc.
 */

const { Kafka } = require('kafkajs');
const xml2js = require('xml2js');
const zlib = require('zlib');

const xmlParser = new xml2js.Parser({
    explicitArray: false,
    ignoreAttrs: false,
    mergeAttrs: false
});

// ============================================
// IN-MEMORY STORE FOR LIVE PUSH PORT DATA
// ============================================

// Map of RID (RTTI Train ID) -> latest train status + formation
const liveTrainStore = new Map();

// Map of RID -> formation/unit data
const formationStore = new Map();

// Consumer state
let consumer = null;
let isConnected = false;
let messageCount = 0;
let lastMessageTime = null;

// ============================================
// KAFKA CONSUMER SETUP
// ============================================

function createKafkaConsumer() {
    const bootstrapServer = process.env.KAFKA_BOOTSTRAP_SERVER;
    const apiKey = process.env.KAFKA_API_KEY;
    const apiSecret = process.env.KAFKA_API_SECRET;
    const topic = process.env.KAFKA_TOPIC || 'darwin.pushport-v16';
    const groupId = process.env.KAFKA_GROUP_ID || 'railway-radar-consumer';

    if (!bootstrapServer || !apiKey || !apiSecret || 
        apiKey === 'your_api_key_here' || apiSecret === 'your_api_secret_here') {
        console.warn('⚠️  Kafka credentials not configured - Push Port feed disabled');
        console.warn('   Set KAFKA_API_KEY and KAFKA_API_SECRET in .env');
        return null;
    }

    const kafka = new Kafka({
        clientId: 'railway-radar',
        brokers: [bootstrapServer],
        ssl: true,
        sasl: {
            mechanism: 'plain',
            username: apiKey,
            password: apiSecret
        },
        connectionTimeout: 30000,
        requestTimeout: 60000,
        retry: {
            initialRetryTime: 3000,
            retries: 15,
            maxRetryTime: 30000
        },
        logLevel: 2  // WARN level (1=ERROR, 2=WARN, 4=INFO, 5=DEBUG)
    });

    return kafka;
}

// ============================================
// START CONSUMING DARWIN PUSH PORT MESSAGES
// ============================================

async function startDarwinConsumer() {
    const kafka = createKafkaConsumer();
    if (!kafka) return false;

    const topic = process.env.KAFKA_TOPIC || 'darwin.pushport-v16';
    const groupId = process.env.KAFKA_GROUP_ID || 'railway-radar-consumer';

    try {
        consumer = kafka.consumer({ groupId });

        console.log('📡 Connecting to Darwin Push Port via Kafka...');
        await consumer.connect();
        isConnected = true;
        console.log('✅ Connected to Confluent Cloud Kafka');

        await consumer.subscribe({ topic, fromBeginning: false });
        console.log(`📥 Subscribed to topic: ${topic}`);

        await consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                try {
                    messageCount++;
                    lastMessageTime = new Date();

                    const rawValue = message.value;
                    if (!rawValue) return;

                    // Darwin messages may be gzip-compressed or plain text
                    let messageStr;
                    try {
                        // Try decompressing first (some feeds send gzipped)
                        const decompressed = zlib.gunzipSync(rawValue);
                        messageStr = decompressed.toString('utf-8');
                    } catch {
                        // Not compressed, treat as plain text
                        messageStr = rawValue.toString('utf-8');
                    }

                    // Rail Data Marketplace sends JSON-formatted messages
                    // Try parsing as JSON first, then handle XML within
                    let content = messageStr;
                    let isJson = false;
                    try {
                        const parsed = JSON.parse(messageStr);
                        isJson = true;
                        
                        // Handle 'bytes' field which contains the actual Darwin JSON/XML payload
                        if (parsed.bytes) {
                            try {
                                const inner = JSON.parse(parsed.bytes);
                                await processDarwinJsonMessage(inner);
                                return;
                            } catch {
                                // bytes field is XML, not JSON
                                content = parsed.bytes;
                            }
                        } else if (parsed.Message) {
                            content = parsed.Message;
                        } else if (parsed.data) {
                            content = parsed.data;
                        } else if (parsed.Pport || parsed.uR || parsed.TS) {
                            // Direct JSON Push Port format
                            await processDarwinJsonMessage(parsed);
                            return;
                        } else {
                            // Entire JSON object is the message
                            await processDarwinJsonMessage(parsed);
                            return;
                        }
                    } catch {
                        // Not JSON, use as-is (likely raw XML)
                    }

                    // Process as XML (either raw or extracted from JSON wrapper)
                    if (content.trim().startsWith('<')) {
                        await processDarwinMessage(content);
                    } else if (!isJson) {
                        // Try processing as-is in case of unexpected format
                        await processDarwinMessage(content);
                    }

                    if (messageCount % 100 === 0) {
                        console.log(`📊 Kafka: ${messageCount} messages processed, ${liveTrainStore.size} trains tracked, ${formationStore.size} formations`);
                    }
                } catch (err) {
                    console.warn('⚠️  Error processing Kafka message:', err.message);
                }
            }
        });

        console.log('🚂 Darwin Push Port consumer running - listening for live train updates');
        return true;

    } catch (error) {
        console.error('❌ Failed to start Kafka consumer:', error.message);
        isConnected = false;
        return false;
    }
}

// ============================================
// PROCESS DARWIN PUSH PORT JSON MESSAGES
// (Rail Data Marketplace JSON format)
// ============================================

async function processDarwinJsonMessage(json) {
    try {
        // The JSON structure varies - handle common patterns from the Push Port JSON feed
        
        // Pattern 1: Top-level has TS, schedule, formation etc.
        if (json.TS || json.trainStatus) {
            const tsArr = normalizeToArray(json.TS || json.trainStatus);
            for (const ts of tsArr) processTrainStatus(ts);
        }

        if (json.formation || json.Formation) {
            const fArr = normalizeToArray(json.formation || json.Formation);
            for (const f of fArr) processFormation(f);
        }

        if (json.schedule || json.Schedule) {
            const sArr = normalizeToArray(json.schedule || json.Schedule);
            for (const s of sArr) processSchedule(s);
        }

        // Pattern 2: Nested under uR (update response)
        const uR = json.uR || json.ur || {};
        if (uR.TS) {
            const tsArr = normalizeToArray(uR.TS);
            for (const ts of tsArr) processTrainStatus(ts);
        }
        if (uR.formation || uR.Formation) {
            const fArr = normalizeToArray(uR.formation || uR.Formation);
            for (const f of fArr) processFormation(f);
        }
        if (uR.schedule || uR.Schedule) {
            const sArr = normalizeToArray(uR.schedule || uR.Schedule);
            for (const s of sArr) processSchedule(s);
        }

        // Pattern 3: Pport wrapper  
        const pport = json.Pport || json.pport || {};
        const pportUr = pport.uR || pport.ur || {};
        if (Object.keys(pportUr).length > 0) {
            if (pportUr.TS) {
                for (const ts of normalizeToArray(pportUr.TS)) processTrainStatus(ts);
            }
            if (pportUr.formation || pportUr.Formation) {
                for (const f of normalizeToArray(pportUr.formation || pportUr.Formation)) processFormation(f);
            }
            if (pportUr.schedule || pportUr.Schedule) {
                for (const s of normalizeToArray(pportUr.schedule || pportUr.Schedule)) processSchedule(s);
            }
        }

        // Log first message structure for debugging
        if (messageCount <= 3) {
            console.log(`📋 Sample Push Port JSON message #${messageCount}:`, JSON.stringify(json).substring(0, 500));
        }

    } catch (err) {
        // Silently skip unparseable messages
    }
}

// ============================================
// PROCESS DARWIN PUSH PORT XML MESSAGES
// ============================================

async function processDarwinMessage(xmlContent) {
    try {
        const parsed = await xmlParser.parseStringPromise(xmlContent);
        
        // Darwin Push Port root element: Pport
        const pport = parsed.Pport || parsed['ns5:Pport'] || parsed['pport:Pport'] || parsed;

        // Navigate through possible namespace prefixes
        const uR = pport.uR || pport['ns5:uR'] || pport['ur:uR'] || {};

        // Process Train Status (TS) messages - these contain live running info
        const trainStatuses = normalizeToArray(uR.TS || uR['ns5:TS'] || uR['ts:TS']);
        for (const ts of trainStatuses) {
            processTrainStatus(ts);
        }

        // Process formation/loading messages
        const formations = normalizeToArray(uR.formation || uR['ns5:formation'] || uR.Formation);
        for (const f of formations) {
            processFormation(f);
        }

        // Process schedule messages (may contain formation references)
        const schedules = normalizeToArray(uR.schedule || uR['ns5:schedule'] || uR.Schedule);
        for (const s of schedules) {
            processSchedule(s);
        }

        // Process train order messages
        const trainOrders = normalizeToArray(uR.trainOrder || uR['ns5:trainOrder']);
        for (const to of trainOrders) {
            processTrainOrder(to);
        }

    } catch (err) {
        // Silently skip unparseable messages (some may be heartbeats)
    }
}

// ============================================
// PROCESS INDIVIDUAL MESSAGE TYPES
// ============================================

function processTrainStatus(ts) {
    // Handle both XML-parsed (attrs in $) and direct JSON (attrs at top level)
    const attrs = ts.$ || {};
    const rid = attrs.rid || ts.rid;
    if (!rid) return;

    const existing = liveTrainStore.get(rid) || {};

    // Extract location reports
    let latestLocation = null;
    
    for (const loc of normalizeToArray(ts.Location || ts['ns5:Location'] || ts.location)) {
        const locAttrs = loc.$ || loc || {};
        latestLocation = {
            tiploc: locAttrs.tpl || loc.tpl,
            wtd: locAttrs.wtd || loc.wtd,
            wta: locAttrs.wta || loc.wta,
            pta: locAttrs.pta || loc.pta,
            ptd: locAttrs.ptd || loc.ptd,
        };

        // Actual times from reports
        const arr = loc.arr || loc['ns5:arr'];
        const dep = loc.dep || loc['ns5:dep'];
        
        if (arr) {
            const arrAttrs = (typeof arr === 'object') ? (arr.$ || arr) : {};
            latestLocation.actualArrival = arrAttrs.at || arrAttrs.et || (typeof arr === 'string' ? arr : null);
            latestLocation.arrivalDelayed = arrAttrs.delayed === 'true' || arrAttrs.delayed === true;
        }
        if (dep) {
            const depAttrs = (typeof dep === 'object') ? (dep.$ || dep) : {};
            latestLocation.actualDeparture = depAttrs.at || depAttrs.et || (typeof dep === 'string' ? dep : null);
            latestLocation.departureDelayed = depAttrs.delayed === 'true' || depAttrs.delayed === true;
        }
    }

    // Extract late reason
    const lateReason = ts.LateReason || ts['ns5:LateReason'] || ts.lateReason;
    let lateReasonText = null;
    if (lateReason) {
        lateReasonText = (typeof lateReason === 'object') ? (lateReason._ || lateReason.value || JSON.stringify(lateReason)) : lateReason;
    }

    liveTrainStore.set(rid, {
        ...existing,
        rid,
        uid: attrs.uid || ts.uid || existing.uid,
        trainId: attrs.trainId || ts.trainId || existing.trainId,
        ssd: attrs.ssd || ts.ssd || existing.ssd,
        toc: attrs.toc || ts.toc || existing.toc,
        isPassengerService: (attrs.isPassengerSvc || ts.isPassengerSvc) !== 'false',
        latestLocation,
        lateReason: lateReasonText,
        lastUpdated: new Date()
    });
}

function processFormation(f) {
    // Handle both XML-parsed (attrs in $) and direct JSON (attrs at top level)
    const attrs = f.$ || {};
    const rid = attrs.rid || f.rid;
    if (!rid) return;

    const coaches = [];
    const coachList = normalizeToArray(f.coaches || f['ns5:coaches'] || f.coach);
    
    for (const coachGroup of coachList) {
        const coachItems = normalizeToArray(coachGroup.coach || coachGroup['ns5:coach'] || coachGroup);
        for (const coach of coachItems) {
            const coachAttrs = (typeof coach === 'object') ? (coach.$ || coach) : {};
            const coachNum = coachAttrs.coachNumber || coachAttrs.number || coach.coachNumber || coach.number;
            if (coachNum) {
                coaches.push({
                    number: coachNum,
                    coachClass: coachAttrs.coachClass || coachAttrs['class'] || coach.coachClass,
                    toilet: coachAttrs.toilet || coach.toilet,
                    loading: coachAttrs.loading || coach.loading
                });
            }
        }
    }

    // Extract unit IDs from the formation source attribute or fid
    const source = attrs.source || f.source;
    const fid = attrs.fid || f.fid;
    
    // The fid (formation ID) often IS the unit number (e.g., "800301")
    let unitNumbers = [];
    if (fid) {
        unitNumbers.push(fid);
    }

    // Also check for unit elements within formation
    const units = normalizeToArray(f.unit || f['ns5:unit'] || f.Unit || f.units);
    for (const unit of units) {
        const unitAttrs = (typeof unit === 'object') ? (unit.$ || unit) : {};
        const unitId = unitAttrs.unitId || unitAttrs.uid || unit.unitId || unit.uid;
        if (unitId) {
            unitNumbers.push(unitId);
        }
    }

    formationStore.set(rid, {
        rid,
        fid,
        unitNumbers,
        coaches,
        coachCount: coaches.length,
        lastUpdated: new Date()
    });

    // Also update the main train store with formation info
    const existing = liveTrainStore.get(rid);
    if (existing) {
        existing.unitNumber = unitNumbers.length > 0 ? unitNumbers.join('+') : fid;
        existing.formation = { fid, unitNumbers, coachCount: coaches.length };
        liveTrainStore.set(rid, existing);
    }
}

function processSchedule(s) {
    // Handle both XML-parsed (attrs in $) and direct JSON (attrs at top level)
    const attrs = s.$ || {};
    const rid = attrs.rid || s.rid;
    if (!rid) return;

    const existing = liveTrainStore.get(rid) || {};

    // Extract origin and destination from schedule
    const origins = normalizeToArray(s.OR || s['ns5:OR'] || s.or || s.origin);
    const destinations = normalizeToArray(s.DT || s['ns5:DT'] || s.dt || s.destination);

    let originTiploc = null;
    let destinationTiploc = null;

    if (origins.length > 0) {
        const orAttrs = origins[0].$ || origins[0] || {};
        originTiploc = orAttrs.tpl || origins[0].tpl;
    }
    if (destinations.length > 0) {
        const dtAttrs = destinations[0].$ || destinations[0] || {};
        destinationTiploc = dtAttrs.tpl || destinations[0].tpl;
    }

    liveTrainStore.set(rid, {
        ...existing,
        rid,
        uid: attrs.uid || s.uid || existing.uid,
        trainId: attrs.trainId || s.trainId || existing.trainId,
        ssd: attrs.ssd || s.ssd || existing.ssd,
        toc: attrs.toc || s.toc || existing.toc,
        isPassengerService: (attrs.isPassengerSvc || s.isPassengerSvc) !== 'false',
        originTiploc: originTiploc || existing.originTiploc,
        destinationTiploc: destinationTiploc || existing.destinationTiploc,
        lastUpdated: existing.lastUpdated || new Date()
    });
}

function processTrainOrder(to) {
    // Train order messages are informational - log but don't need primary processing
}

// ============================================
// PUBLIC API: Get enriched train data with unit numbers
// ============================================

/**
 * Get all live trains with formation/unit data from Push Port.
 * Returns an array of trains enriched with unit numbers.
 */
function getLiveTrainsWithFormations() {
    const trains = [];
    
    for (const [rid, train] of liveTrainStore) {
        // Only include passenger services with recent updates (last 360 mins)
        const age = Date.now() - (train.lastUpdated?.getTime() || 0);
        if (age > 360 * 60 * 1000) continue;
        if (train.isPassengerService === false) continue;

        const formation = formationStore.get(rid);
        
        trains.push({
            rid,
            uid: train.uid,
            trainId: train.trainId,
            toc: train.toc,
            originTiploc: train.originTiploc,
            destinationTiploc: train.destinationTiploc,
            unitNumber: formation?.unitNumbers?.join('+') || train.unitNumber || null,
            formation: formation ? {
                fid: formation.fid,
                unitNumbers: formation.unitNumbers,
                coachCount: formation.coachCount
            } : null,
            latestLocation: train.latestLocation,
            lateReason: train.lateReason,
            lastUpdated: train.lastUpdated
        });
    }

    return trains;
}

/**
 * Look up unit number(s) for a specific train by RID
 */
function getUnitNumberByRid(rid) {
    const formation = formationStore.get(rid);
    if (formation && formation.unitNumbers.length > 0) {
        return formation.unitNumbers.join('+');
    }
    
    const train = liveTrainStore.get(rid);
    if (train && train.unitNumber) {
        return train.unitNumber;
    }

    return null;
}

/**
 * Get consumer status for health checks
 */
function getConsumerStatus() {
    return {
        connected: isConnected,
        messagesProcessed: messageCount,
        lastMessageTime,
        trackedTrains: liveTrainStore.size,
        formationsKnown: formationStore.size
    };
}

// ============================================
// GRACEFUL DISCONNECT
// ============================================

async function stopDarwinConsumer() {
    if (consumer) {
        console.log('📡 Disconnecting Darwin Kafka consumer...');
        try {
            await consumer.disconnect();
            isConnected = false;
            console.log('✅ Kafka consumer disconnected');
        } catch (err) {
            console.warn('⚠️  Error disconnecting Kafka:', err.message);
        }
    }
}

// ============================================
// UTILITY
// ============================================

function normalizeToArray(val) {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    return [val];
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    startDarwinConsumer,
    stopDarwinConsumer,
    getLiveTrainsWithFormations,
    getUnitNumberByRid,
    getConsumerStatus,
    liveTrainStore,
    formationStore
};

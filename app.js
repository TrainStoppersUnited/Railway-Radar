// Railway Radar JavaScript
console.log("Railway Radar loaded");

// Initialize the map centered on Britain
const map = L.map('map').setView([54.7023545, -3.2765753], 6);

// WebSocket real-time connection
const socket = io();
socket.on('trains', (data) => {
    console.log('📡 Real-time update received from server:', data.trains?.length, 'trains');
    
    const statusEl = document.getElementById('location-status');
    if (data.stale) {
        console.warn('⚠️ Server returned stale fallback data (S3 is down)');
        if (statusEl) {
            statusEl.textContent = '⚠️ Offline Mode (Using Stale Data)';
            statusEl.style.color = '#ff9900';
        }
    } else if (statusEl && statusEl.textContent.includes('Offline Mode')) {
        // Reset if we recovered from being offline but don't overwrite if it says "Location access granted"
        statusEl.textContent = '✅ Connected (Live Updates)';
        statusEl.style.color = '#00cc00';
    }

    liveTrains = data.trains || [];

    // Check if we have active search query to filter
    const query = document.getElementById('search-input')?.value?.toLowerCase()?.trim();
    if (query) {
        performSearch(query); // update view with filtered trains
    } else {
        // Option 1: Don't display anything if no search
        // Option 2: If we had a view showing them all, we could do displayTrains(liveTrains)
        console.log('⏳ Update stored in background, waiting for search');
        // displayTrains(liveTrains);
    }
});

// Add OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Store markers for trains and user location
let userLocationMarker = null;
let trainMarkers = [];
let liveTrains = []; // Store live trains for search functionality
let railwayLines = []; // Store railway line layers

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getTrainDetailsUrl(train) {
    return `train-details.html?id=${encodeURIComponent(train.id)}`;
}

// ============================================
// DISPLAY UK RAILWAY NETWORK (OpenRailwayMap tile overlay)
// ============================================
function loadRailwayNetwork() {
    try {
        console.log('🛤️  Loading UK railway network via OpenRailwayMap tiles...');
        
        // OpenRailwayMap provides pre-rendered railway tiles from OSM data
        // No heavy Overpass queries needed — tiles load on demand per viewport
        const railwayLayer = L.tileLayer('https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a> contributors',
            maxZoom: 19,
            opacity: 0.75
        });
        
        railwayLayer.addTo(map);
        railwayLines.push(railwayLayer);
        
        console.log('✅ OpenRailwayMap railway tile layer added to map');
        
    } catch (error) {
        console.error('❌ Error loading railway network:', error);
    }
}

// ============================================
// GEOLOCATION: Request user location and zoom
// ============================================
function requestUserLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                map.setView([latitude, longitude], 13);
                
                // Add user location marker
                if (userLocationMarker) {
                    map.removeLayer(userLocationMarker);
                }
                userLocationMarker = L.circleMarker([latitude, longitude], {
                    color: '#0066ff',
                    fillColor: '#0066ff',
                    fillOpacity: 0.7,
                    radius: 8,
                    weight: 2
                }).addTo(map).bindPopup('Your Location');
                
                document.getElementById('location-status').textContent = '✓ Location access granted';
                document.getElementById('location-status').style.color = '#00cc00';
            },
            (error) => {
                console.warn('Geolocation error:', error);
                document.getElementById('location-status').textContent = '✗ Location access denied';
                document.getElementById('location-status').style.color = '#ff0000';
            }
        );
    } else {
        alert('Geolocation is not supported by your browser');
    }
}

// ============================================
// FETCH LIVE TRAINS FROM BACKEND (Darwin API)
// ============================================
async function fetchLiveTrains() {
    try {
        console.log('🌐 Attempting to fetch from /api/trains...');
        
        // Check server health first
        try {
            const healthCheck = await fetch('/api/health');
            if (!healthCheck.ok) {
                throw new Error('Server health check failed');
            }
            console.log('✅ Server is healthy');
        } catch (healthError) {
            console.error('❌ Server health check failed:', healthError.message);
            throw new Error('Cannot connect to server. Please ensure the backend is running.');
        }
        
        const response = await fetch('/api/trains');
        console.log('✅ Response received:', response.status, response.statusText);
        
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('📡 API Response received:', data);
        console.log('🚆 Trains array:', data.trains);
        console.log('📊 Number of trains:', data.trains ? data.trains.length : 0);
        
        const statusEl = document.getElementById('location-status');
        if (data.stale) {
            console.warn('⚠️ API returned stale fallback data (S3 is down). Reason:', data.error);
            if (statusEl) {
                statusEl.textContent = '⚠️ Offline Mode (Using Stale Data)';
                statusEl.style.color = '#ff9900';
            }
        } else if (statusEl && statusEl.textContent.includes('Offline Mode')) {
            statusEl.textContent = '✅ Connected (Live Updates)';
            statusEl.style.color = '#00cc00';
        }

        if (data.error && !data.stale) {
            console.warn('⚠️ API Error:', data.error);
        }
        return data.trains || [];
    } catch (error) {
        console.error('❌ Error fetching trains:', error);
        console.error('Error details:', error.message);
        console.error('💡 Troubleshooting:');
        console.error('   1. Ensure the backend server is running (npm start)');
        console.error('   2. Check that .env file has valid AWS credentials');
        console.error('   3. Verify network connectivity');
        return [];
    }
}

// ============================================
// DISPLAY TRAINS ON MAP
// ============================================
async function displayTrains(trainsToDisplay = null) {
    // Clear existing train markers
    trainMarkers.forEach(marker => map.removeLayer(marker));
    trainMarkers = [];
    
    console.log('🔄 displayTrains called');
    
    // Use provided trains or fetch all trains
    let trains = trainsToDisplay;
    if (!trains) {
        console.log('🔄 Fetching live trains...');
        trains = await fetchLiveTrains();
        liveTrains = trains; // Store trains for search functionality
        console.log('💾 Stored in liveTrains - now available:', liveTrains.length, 'trains');
    }
    
    console.log('🗺️  Displaying trains on map:', trains.length, 'trains');
    
    trains.forEach(train => {
        const marker = L.circleMarker([train.lat, train.lng], {
            color: '#ff6600',
            fillColor: '#ff6600',
            fillOpacity: 0.8,
            radius: 6,
            weight: 2
        }).addTo(map);
        
        marker.bindPopup(`
            <strong>${train.name}</strong><br>
            ID: ${train.id}<br>
            ${train.unitNumber ? `Unit: ${train.unitNumber}<br>` : ''}
            ${train.operator ? `Operator: ${train.operator}<br>` : ''}
            From: ${train.station}${train.originCode ? ` (${train.originCode})` : ''}<br>
            To: ${train.destination}${train.destinationCode ? ` (${train.destinationCode})` : ''}<br>
            ${train.departureTime ? `Departs: ${train.departureTime}<br>` : ''}
            ${train.arrivalTime ? `Arrives: ${train.arrivalTime}<br>` : ''}
            ${train.progress != null ? `Progress: ${train.progress}%<br>` : ''}
            Status: ${train.status || 'En Route'}<br>
            <a href="${getTrainDetailsUrl(train)}" class="popup-link">Open full details</a>
        `);
        
        trainMarkers.push(marker);
    });
    
    console.log('🗺️  Rendered', trainMarkers.length, 'train markers using realistic station-based coordinates');
    
    // Update train list panel
    updateTrainList(trains);
}

// ============================================
// UPDATE TRAIN LIST PANEL
// ============================================
function updateTrainList(trains) {
    const trainList = document.getElementById('train-list');
    if (!trainList) return;
    
    if (trains.length === 0) {
        trainList.innerHTML = '<p>No trains currently visible</p>';
        return;
    }
    
    let html = '';
    trains.forEach((train, index) => {
        const unitInfo = train.unitNumber ? ` | Unit: ${train.unitNumber}` : '';
        html += `
            <a class="train-item train-link" data-index="${index}" href="${getTrainDetailsUrl(train)}">
                <strong>Headcode: ${train.name}</strong> (ID: ${train.id})${unitInfo}<br>
                <small>From: <strong>${train.station}</strong> (${train.originCode}) → <strong>${train.destination}</strong> (${train.destinationCode})</small><br>
                <small>Status: ${train.status || 'On Time'}</small><br>
                <small class="view-train-link">View full journey details →</small>
            </a>
        `;
    });
    
    trainList.innerHTML = html;
}

// ============================================
// STATION DATABASE (public data loaded from API)
// ============================================
let ukStations = [];

async function loadStations() {
    try {
        const response = await fetch('/api/stations');
        if (!response.ok) throw new Error('Failed to load stations');
        ukStations = await response.json();
        console.log('✅ Loaded stations:', ukStations.length);
    } catch (error) {
        console.error('❌ Error loading stations:', error);
    }
}

// ============================================
// SEARCH FUNCTIONALITY
// ============================================
async function performSearch(query) {
    query = query.toLowerCase().trim();
    console.log('🔎 performSearch called with:', query);
    
    if (!query) {
        document.getElementById('search-results').innerHTML = '<p>Enter a station or train name</p>';
        // Clear map and train list
        trainMarkers.forEach(marker => map.removeLayer(marker));
        trainMarkers = [];
        updateTrainList([]);
        return;
    }
    
    // Check if trains have loaded, if not fetch them
    if (liveTrains.length === 0) {
        console.warn('⚠️  Trains not loaded yet - fetching data');
        document.getElementById('search-results').innerHTML = '<p class="loading">⏳ Loading train data...</p>';
        const trains = await fetchLiveTrains();
        liveTrains = trains;
        console.log('✅ Trains loaded:', liveTrains.length);
    }
    
    // Search stations
    const stationResults = ukStations.filter(station => 
        station.name.toLowerCase().includes(query) || 
        station.code.toLowerCase().includes(query)
    );
    
    // Search live trains from the API
    const trainResults = liveTrains.filter(train =>
    (train.name && train.name.toLowerCase().includes(query)) ||
    (train.station && train.station.toLowerCase().includes(query)) ||
    (train.destination && train.destination.toLowerCase().includes(query)) ||
    (train.id && train.id.toLowerCase().includes(query)) ||
    (train.unitNumber && train.unitNumber.toLowerCase().includes(query)) // ← FIX
);

    
    console.log('✅ Results - Stations:', stationResults.length, 'Trains:', trainResults.length);
    
    let resultsHTML = '';
    
    if (stationResults.length > 0) {
        resultsHTML += '<h3>Stations:</h3><ul>';
        // In case the API wraps the data in { stations: [] }, check both
        const stationsList = stationResults.stations || stationResults;
        stationsList.forEach(station => {
            resultsHTML += `<li><strong>${station.name}</strong> (${station.code}) - <button class="zoom-btn" data-lat="${station.lat}" data-lng="${station.lng}">Zoom Here</button></li>`;
        });
        resultsHTML += '</ul>';
    }
    
    if (trainResults.length > 0) {
        resultsHTML += `<h3>Trains:</h3><p>Found ${trainResults.length} train${trainResults.length !== 1 ? 's' : ''} matching your search.</p><div class="search-train-results">`;
        trainResults.forEach(train => {
            resultsHTML += `
                <a class="search-result-card train-link" href="${getTrainDetailsUrl(train)}">
                    <strong>Headcode: ${escapeHtml(train.name)}</strong>
                    <span class="search-result-meta">Train ID: ${escapeHtml(train.id)}</span>
                    <span class="search-result-meta">Start: ${escapeHtml(train.departureTime || 'Unknown')}</span>
                    <span class="search-result-meta">Route: ${escapeHtml(train.station)} → ${escapeHtml(train.destination)}</span>
                    <span class="search-result-action">Open train page →</span>
                </a>
            `;
        });
        resultsHTML += '</div>';
    }
    
    if (stationResults.length === 0 && trainResults.length === 0) {
        resultsHTML = '<p>No results found for "' + query + '"</p>';
        // Clear map when no results
        trainMarkers.forEach(marker => map.removeLayer(marker));
        trainMarkers = [];
        updateTrainList([]);
    } else {
        // Display matching trains on the map
        displayTrains(trainResults);
    }
    
    document.getElementById('search-results').innerHTML = resultsHTML;
    
    // Add event listeners to zoom buttons
    document.querySelectorAll('.zoom-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const lat = parseFloat(e.target.dataset.lat);
            const lng = parseFloat(e.target.dataset.lng);
            map.setView([lat, lng], 13);
        });
    });
}

// ============================================
// SEARCH FORM SUBMISSION
// ============================================
function attachSearchListener() {
    const searchForm = document.querySelector('.search-form');
    if (searchForm) {
        searchForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const query = document.getElementById('search-input').value;
            console.log('🔍 Search triggered with query:', query);
            console.log('📊 liveTrains available:', liveTrains.length);
            performSearch(query);
        });
        console.log('✅ Search form listener attached');
    } else {
        console.warn('⚠️  Search form not found');
    }
}

// ============================================
// INITIALIZE
// ============================================

// Start app without loading trains automatically
document.addEventListener('DOMContentLoaded', function() {
    console.log('📄 DOM Content Loaded - initializing app');
    document.getElementById('search-results').innerHTML = '<p>Search for a station or train to see results</p>';
    document.getElementById('train-list').innerHTML = '<p>Enter a search query to find trains</p>';
    
    // Load station database
    loadStations();
    
    attachSearchListener();
    requestUserLocation();

    // Load comprehensive UK railway network
    loadRailwayNetwork();
});
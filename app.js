// Railway Radar JavaScript
console.log("Railway Radar loaded");

// Initialize the map centered on Britain
const map = L.map('map').setView([54.7023545, -3.2765753], 6); // Center on Britain, zoom level 6

// Add OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Add your JavaScript code here
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderStations(stations) {
    if (!stations || stations.length === 0) {
        return '<p>No route stations available for this service.</p>';
    }

    return `
        <div class="station-list">
            ${stations.map((station, index) => `
                <article class="station-stop">
                    <div>
                        <span class="station-index">${index + 1}</span>
                        <div>
                            <h3>${escapeHtml(station.name)}</h3>
                            <p>${escapeHtml(station.code || 'Unknown code')} · ${escapeHtml(station.type || 'Station')}</p>
                        </div>
                    </div>
                    <div class="station-times">
                        <span>${escapeHtml(station.time || station.scheduledDeparture || station.scheduledArrival || station.passTime || 'Time unknown')}</span>
                        ${station.platform ? `<small>Platform ${escapeHtml(station.platform)}</small>` : ''}
                    </div>
                </article>
            `).join('')}
        </div>
    `;
}

async function loadTrainDetails() {
    const content = document.getElementById('train-detail-content');
    const params = new URLSearchParams(window.location.search);
    const trainId = params.get('id');

    if (!trainId) {
        content.innerHTML = '<p>Missing train ID.</p>';
        return;
    }

    try {
        const response = await fetch(`/api/trains/${encodeURIComponent(trainId)}/details`);
        if (!response.ok) {
            throw new Error(response.status === 404 ? 'Train not found.' : 'Unable to load train details.');
        }

        const detail = await response.json();

        content.innerHTML = `
            <div class="detail-summary-grid">
                <div class="summary-item">
                    <span>Headcode</span>
                    <strong>${escapeHtml(detail.headcode || 'Unknown')}</strong>
                </div>
                <div class="summary-item">
                    <span>Time of start</span>
                    <strong>${escapeHtml(detail.startTime || 'Unknown')}</strong>
                </div>
                <div class="summary-item">
                    <span>Train ID</span>
                    <strong>${escapeHtml(detail.trainId || 'Unknown')}</strong>
                </div>
                <div class="summary-item">
                    <span>Unit numbers</span>
                    <strong>${escapeHtml(detail.unitNumber || 'Not available')}</strong>
                </div>
            </div>

            <div class="detail-meta">
                <p><strong>Service date:</strong> ${escapeHtml(detail.serviceDate || 'Unknown')}</p>
                <p><strong>Operator:</strong> ${escapeHtml(detail.operator || 'Unknown')}</p>
                <p><strong>UID:</strong> ${escapeHtml(detail.uid || 'Unknown')}</p>
            </div>

            <section class="detail-route-section">
                <h2>Stations en route</h2>
                ${renderStations(detail.stations)}
            </section>
        `;
    } catch (error) {
        content.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    }
}

document.addEventListener('DOMContentLoaded', loadTrainDetails);

const Database = require('better-sqlite3');
const path = require('path');

let db;

function init(dbPath = path.join(__dirname, 'railway-radar.db')) {
    db = new Database(dbPath, { verbose: console.log });

    // Creates the historical train positions table
    db.exec(`
        CREATE TABLE IF NOT EXISTS trains_history (
            auto_id INTEGER PRIMARY KEY AUTOINCREMENT,
            id TEXT,
            name TEXT,
            lat REAL,
            lng REAL,
            station TEXT,
            destination TEXT,
            originCode TEXT,
            destinationCode TEXT,
            operator TEXT,
            status TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Create an index for quick lookup by train id
    db.exec(`CREATE INDEX IF NOT EXISTS idx_train_id ON trains_history(id);`);
    console.log(`✅ SQLite Database initialized at ${dbPath}`);
}

function getDb() {
    if (!db) {
        init();
    }
    return db;
}

function close() {
    if (db) {
        db.close();
        db = null;
    }
}

function saveTrainData(trains) {
    if (!db) getDb();
    
    // Prepare an insert statement
    const insert = db.prepare(`
        INSERT INTO trains_history 
        (id, name, lat, lng, station, destination, originCode, destinationCode, operator, status)
        VALUES (@id, @name, @lat, @lng, @station, @destination, @originCode, @destinationCode, @operator, @status)
    `);

    // Run within a transaction for performance
    const insertMany = db.transaction((trainList) => {
        let count = 0;
        for (const train of trainList) {
            // Fill missing values dynamically or fallback
            insert.run({
                id: train.id || '',
                name: train.name || '',
                lat: train.lat || 0.0,
                lng: train.lng || 0.0,
                station: train.station || '',
                destination: train.destination || '',
                originCode: train.originCode || '',
                destinationCode: train.destinationCode || '',
                operator: train.operator || '',
                status: train.status || ''
            });
            count++;
        }
        return count;
    });

    try {
        const rowsInserted = insertMany(trains);
        console.log(`💾 Persisted ${rowsInserted} train records to SQLite.`);
        return rowsInserted;
    } catch (err) {
        console.error('❌ Error saving train data to SQLite:', err.message);
        return 0;
    }
}

function getHistoricalData(trainId, limit = 50) {
    if (!db) getDb();
    
    // Ordered by latest first
    const stmt = db.prepare(`
        SELECT * FROM trains_history 
        WHERE id = ? 
        ORDER BY timestamp DESC 
        LIMIT ?
    `);
    
    return stmt.all(trainId, limit);
}

function getLatestTrainPositions() {
    if (!db) getDb();
    
    // Get the latest position for each train ID within the last 24 hours
    const stmt = db.prepare(`
        SELECT * FROM (
            SELECT *, ROW_NUMBER() OVER(PARTITION BY id ORDER BY timestamp DESC) as rn 
            FROM trains_history
            WHERE timestamp >= datetime('now', '-1 day')
        )
        WHERE rn = 1
    `);
    
    return stmt.all();
}

module.exports = {
    init,
    getDb,
    close,
    saveTrainData,
    getHistoricalData,
    getLatestTrainPositions
};

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const dbService = require('../db');

describe('Database Persistence (SQLite)', () => {
    const testDbPath = path.join(__dirname, 'test.db');

    beforeAll(() => {
        // Initialize a clean test database
        dbService.init(testDbPath);
    });

    afterAll(() => {
        // Close and remove the test database
        dbService.close();
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }
    });

    it('should create the trains_history table correctly', () => {
        const db = dbService.getDb();
        const tableInfo = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='trains_history'").get();
        expect(tableInfo).toBeDefined();
        expect(tableInfo.name).toBe('trains_history');
    });

    it('should save a batch of train data into the database', () => {
        const mockTrains = [
            {
                id: 'TR001',
                name: '1A23',
                lat: 51.5307,
                lng: -0.1234,
                station: "London King's Cross",
                destination: "Edinburgh Waverley",
                originCode: "KGX",
                destinationCode: "EDB",
                operator: "LNER",
                status: "On Time"
            },
            {
                id: 'TR002',
                name: '2B34',
                lat: 52.5079,
                lng: -1.9038,
                station: "Birmingham New Street",
                destination: "Manchester Piccadilly",
                originCode: "BHM",
                destinationCode: "MAN",
                operator: "Avanti",
                status: "Delayed"
            }
        ];

        // Save mock trains
        const insertions = dbService.saveTrainData(mockTrains);
        expect(insertions).toBe(2);

        // Verify insertion
        const history = dbService.getHistoricalData('TR001');
        expect(history.length).toBe(1);
        expect(history[0].name).toBe('1A23');
        expect(history[0].station).toBe("London King's Cross");
        expect(history[0].operator).toBe("LNER");
    });

    it('should append multiple records for the same train over time', async () => {
        // Waiting 1s ensures the timestamp is explicitly higher for the update
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const trainUpdate = [
            {
                id: 'TR001',
                name: '1A23',
                lat: 51.6000,
                lng: -0.1500,
                station: "Stevenage",
                destination: "Edinburgh Waverley",
                originCode: "KGX",
                destinationCode: "EDB",
                operator: "LNER",
                status: "On Time"
            }
        ];

        dbService.saveTrainData(trainUpdate);
        
        const history = dbService.getHistoricalData('TR001');
        expect(history.length).toBe(2); // Initial record + updated record
        // Order is descending by timestamp by default in getHistoricalData
        expect(history[0].station).toBe("Stevenage"); 
        expect(history[1].station).toBe("London King's Cross");
    });
});
const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
require('dotenv').config();

const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'eu-west-1'
});

console.log('🚂 Darwin API Data Collector');
console.log('=============================\n');

async function collectDarwinData() {
    try {
        console.log('📡 Connecting to S3 bucket: darwin.xmltimetable');
        
        const listParams = {
            Bucket: 'darwin.xmltimetable',
            Prefix: 'PPTimetable/'
        };

        const listResponse = await s3.listObjectsV2(listParams).promise();
        console.log(`✓ Found ${listResponse.Contents?.length || 0} files\n`);

        if (!listResponse.Contents || listResponse.Contents.length === 0) {
            console.log('❌ No files found!');
            return;
        }

        const latestFile = listResponse.Contents.sort((a, b) => 
            new Date(b.LastModified) - new Date(a.LastModified)
        )[0];

        console.log(`📋 Latest: ${latestFile.Key}`);
        console.log(`📅 Modified: ${latestFile.LastModified}`);
        console.log(`💾 Size: ${(latestFile.Size / 1024).toFixed(2)} KB\n`);
        console.log('⏳ Fetching...');

        const getParams = {
            Bucket: 'darwin.xmltimetable',
            Key: latestFile.Key
        };

        const startTime = Date.now();
        const fileResponse = await s3.getObject(getParams).promise();
        const fetchTime = Date.now() - startTime;
        console.log(`✓ Retrieved in ${fetchTime}ms\n`);

        let rawData;
        if (latestFile.Key.endsWith('.gz')) {
            console.log('🔧 Decompressing gzip...');
            const decompressStart = Date.now();
            rawData = await new Promise((resolve, reject) => {
                zlib.gunzip(fileResponse.Body, (err, decompressed) => {
                    if (err) reject(err);
                    else resolve(decompressed.toString('utf-8'));
                });
            });
            const decompressTime = Date.now() - decompressStart;
            console.log(`✓ Decompressed in ${decompressTime}ms\n`);
        } else {
            rawData = fileResponse.Body.toString('utf-8');
        }

        const outputPath = path.join(__dirname, 'darwin-raw-data.txt');
        fs.writeFileSync(outputPath, rawData);
        console.log(`✓ Saved to: darwin-raw-data.txt`);
        console.log(`  Size: ${(rawData.length / 1024).toFixed(2)} KB\n`);

        console.log('📄 First 1500 characters:');
        console.log('========================');
        console.log(rawData.substring(0, 1500));
        console.log('\n...\n');

        console.log('🔍 Analysis:');
        if (rawData.includes('<?xml')) {
            console.log('✓ Valid XML detected\n');
            
            const journeyMatches = rawData.match(/<Journey/g) || [];
            const trainMatches = rawData.match(/<Train/g) || [];
            const serviceMatches = rawData.match(/<Service/g) || [];
            const locationMatches = rawData.match(/<Location/g) || [];
            const stationMatches = rawData.match(/<Station/g) || [];
            
            console.log('Element counts:');
            console.log(`  - Journey: ${journeyMatches.length}`);
            console.log(`  - Train: ${trainMatches.length}`);
            console.log(`  - Service: ${serviceMatches.length}`);
            console.log(`  - Location: ${locationMatches.length}`);
            console.log(`  - Station: ${stationMatches.length}\n`);

            const rootMatch = rawData.match(/<([^\s>]+)/);
            if (rootMatch) console.log(`Root: <${rootMatch[1]}>`);

            const journeyMatch = rawData.match(/<Journey[^>]*>[\s\S]*?<\/Journey>/);
            if (journeyMatch) {
                console.log('\n📋 Sample Journey:');
                console.log(journeyMatch[0].substring(0, 500) + '...\n');
            }
        }

        console.log('✅ Complete! Data saved to darwin-raw-data.txt');

    } catch (error) {
        console.error('\n❌ Error:', error.message);
    }
}

collectDarwinData();

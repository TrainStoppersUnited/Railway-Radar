# Railway Radar - Setup Guide

## ⚠️ SECURITY NOTICE

**Your AWS credentials have been exposed publicly.** You MUST:
1. Go to AWS Console → IAM → Access Keys
2. Deactivate/Delete the exposed key: `AKIA...REDACTED`
3. Create new credentials
4. Update your `.env` file with the new credentials

Never commit `.env` files or credentials to version control!

---

## Installation & Setup

### 1. Install Dependencies

```bash
cd "c:\Users\Oscar\Desktop\Railway Radar"
npm install
```

This installs:
- **Express**: Web server
- **AWS SDK**: For S3 access
- **xml2js**: For parsing Darwin XML
- **CORS**: For cross-origin requests

### 2. Configure Environment Variables

Create a `.env` file in the project root:

```
AWS_ACCESS_KEY_ID=your_new_access_key
AWS_SECRET_ACCESS_KEY=your_new_secret_key
AWS_REGION=eu-west-1
S3_BUCKET=darwin.xmltimetable
S3_PREFIX=PPTimetable/
PORT=3000
```

**DO NOT commit `.env` to git!**

### 3. Start the Server

```bash
npm start
```

Server will run at: `http://localhost:3000`

### 4. Open in Browser

Navigate to: `http://localhost:3000`

---

## How It Works

### Backend (server.js)
- Fetches timetable XML from Darwin S3 bucket
- Parses XML to extract train data
- Provides `/api/trains` endpoint
- Provides `/api/stations` endpoint
- **Credentials stay secure** on the server

### Frontend (app.js)
- Calls `http://localhost:3000/api/trains` every 60 seconds
- Displays trains on the map
- Falls back to mock data if backend unavailable
- Users see live train positions

---

## Next Steps

### 1. Parse Darwin XML Correctly
The current parser uses generic paths. You need to:
- Get a sample Darwin XML file
- Adjust `parseTrainData()` function to match the actual XML structure
- Extract real coordinates (lat/lng) for each train

### 2. Enable Environment Variables
Update `server.js` to use `dotenv`:

```javascript
require('dotenv').config();

const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION
});
```

Install dotenv:
```bash
npm install dotenv
```

### 3. Production Deployment
When deploying:
- Use environment variables (not hardcoded credentials)
- Deploy backend to a server (Heroku, AWS, etc.)
- Update frontend API URL from `localhost:3000` to your server URL
- Enable HTTPS for security

---

## Troubleshooting

**Error: Cannot find module 'express'**
- Run: `npm install`

**Error: S3 Access Denied**
- Check AWS credentials in `.env`
- Verify S3 bucket permissions
- Ensure credentials haven't expired

**Trains not showing on map**
- Check browser console for errors
- Verify backend is running (`npm start`)
- Check that `http://localhost:3000/api/trains` returns data

**CORS errors**
- Make sure backend is running
- Check that CORS middleware is enabled in server.js

---

## File Structure

```
Railway Radar/
├── app.js              (Frontend - interactive map)
├── index.html          (Frontend - HTML)
├── styles.css          (Frontend - styling)
├── server.js           (Backend - Express server)
├── package.json        (Dependencies)
├── .env.example        (Example environment file)
└── assets/             (Optional images/resources)
```

---

## Current Features

✅ Live train display on map (from Darwin API)
✅ Location access & zoom to user position
✅ Search stations and trains
✅ Railway archive section
✅ Google AdSense placeholder
✅ Mobile responsive design
✅ Auto-refresh trains every 60 seconds

---

## Support

For issues with:
- **Darwin API**: Contact National Rail Enquiries support
- **AWS S3**: Check AWS console and permissions
- **Node.js/Express**: See Express documentation

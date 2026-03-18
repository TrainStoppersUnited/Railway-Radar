# 🚀 Quick Start Guide

## ⚡ Running the Application

### 1. Check your .env file
Make sure you have a `.env` file in the root directory:
```bash
AWS_ACCESS_KEY_ID=your_actual_access_key
AWS_SECRET_ACCESS_KEY=your_actual_secret_key
AWS_REGION=eu-west-1
PORT=3000
```

### 2. Start the server
```bash
npm start
```

You should see:
```
🚂 Railway Radar server running on http://localhost:3000
📡 API endpoints:
   - GET /api/trains
   - GET /api/stations
   - GET /api/health
```

### 3. Open in browser
Navigate to: `http://localhost:3000`

---

## 🔍 Testing the API

### Check server health
```bash
# PowerShell
Invoke-WebRequest -Uri http://localhost:3000/api/health | Select-Object -ExpandProperty Content

# Or in browser
http://localhost:3000/api/health
```

### Get live trains
```bash
# PowerShell
Invoke-WebRequest -Uri http://localhost:3000/api/trains | Select-Object -ExpandProperty Content

# Or in browser
http://localhost:3000/api/trains
```

### Get stations
```bash
http://localhost:3000/api/stations
```

---

## ❌ Troubleshooting

### Error: "AWS credentials not found"
**Fix:** Create a `.env` file with your AWS credentials:
```bash
cp .env.example .env
# Then edit .env with your actual credentials
```

### Error: "Failed to fetch"
**Cause:** Server is not running
**Fix:** 
```bash
npm start
```

### Error: "EADDRINUSE: Port 3000 already in use"
**Fix:** Kill the process using port 3000:
```powershell
# Find the process
Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess

# Kill it
Stop-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess -Force

# Or use a different port in .env
PORT=3001
```

### Trains not showing on map
**Possible causes:**
1. AWS credentials are invalid
2. S3 bucket is empty or inaccessible
3. XML parsing error

**Debug:**
1. Check browser console (F12)
2. Check server console logs
3. Verify AWS credentials have S3 read permissions

---

## 🛑 Stopping the Server

### If running in terminal
Press `Ctrl + C`

### If running in background
```powershell
# Find Node processes
Get-Process | Where-Object { $_.ProcessName -like "*node*" }

# Stop all Node processes
Get-Process | Where-Object { $_.ProcessName -like "*node*" } | Stop-Process -Force
```

---

## 📊 Monitoring

### Check logs
All logs appear in the terminal where you ran `npm start`

### Key log messages to watch for:
- ✅ `Server running on http://localhost:3000` - Server started successfully
- ✅ `Returning cached train data` - Cache is working
- ✅ `Successfully parsed X trains` - Data fetched successfully
- ❌ `Error fetching trains from S3` - AWS access issue
- ⚠️ `Station code "XXX" not found` - Missing station data

---

## 🔧 Development Mode

For development with auto-restart on file changes:
```bash
npm run dev
```

This uses `nodemon` to automatically restart the server when you edit files.

---

## 📝 Making Changes

### Editing the map (app.js)
```javascript
// Change map center
const map = L.map('map').setView([51.5074, -0.1278], 10); // London

// Change refresh interval (milliseconds)
trainRefreshTimer = setInterval(displayTrains, 30000); // 30 seconds
```

### Editing API endpoints (server.js)
```javascript
// Add a new endpoint
app.get('/api/custom', (req, res) => {
    res.json({ message: 'Custom endpoint' });
});
```

### Editing styles (styles.css)
Changes take effect immediately - just refresh the browser.

---

## 🎯 Next Steps

1. ✅ Verify the application works
2. ✅ Test all endpoints
3. 📖 Read [ARCHITECTURE_REVIEW.md](ARCHITECTURE_REVIEW.md) for improvement ideas
4. 🔐 Secure your AWS credentials
5. 📱 Test on mobile devices
6. 🚀 Deploy to production (see deployment guide below)

---

## 🌐 Deployment Checklist

Before deploying to production:

- [ ] Add `.env` to `.gitignore` (already done)
- [ ] Use environment variables for sensitive data
- [ ] Enable HTTPS
- [ ] Add proper error handling
- [ ] Set up monitoring (Sentry, CloudWatch)
- [ ] Configure CORS for your domain only
- [ ] Add rate limiting (already done)
- [ ] Run security audit
- [ ] Load testing
- [ ] Set up CI/CD pipeline

---

## 📞 Getting Help

1. Check browser console (F12) for frontend errors
2. Check terminal/server logs for backend errors
3. Review [ARCHITECTURE_REVIEW.md](ARCHITECTURE_REVIEW.md)
4. Check [README.md](README.md) for detailed documentation

---

**Happy coding! 🚂**

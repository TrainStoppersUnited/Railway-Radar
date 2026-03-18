        # 🚂 Railway Radar

**Live UK Railway Train Tracking Application**

A real-time train tracking web application that displays live UK railway information using data from National Rail's Darwin timetable feed via AWS S3.

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen)](https://nodejs.org/)

---

## ✨ Features

- 🗺️ **Interactive Map** - Real-time train positions on Leaflet.js map
- 📍 **Geolocation** - Automatically zoom to your location
- 🔍 **Search** - Find trains by ID, station, or route
- 🚆 **Live Updates** - Train data refreshes every 60 seconds
- 📊 **Station Database** - 50+ UK stations with accurate coordinates
- 📱 **Responsive Design** - Works on desktop and mobile

---

## 🚀 Quick Start

### Prerequisites

- Node.js >= 14.0.0
- npm or yarn
- AWS credentials for Darwin S3 bucket access

### Installation

1. **Clone the repository**
   ```bash
   cd "Railway Radar"
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**
   ```bash
   # Copy the example file
   cp .env.example .env
   
   # Edit .env with your AWS credentials
   # AWS_ACCESS_KEY_ID=your_access_key_here
   # AWS_SECRET_ACCESS_KEY=your_secret_key_here
   # AWS_REGION=eu-west-1
   ```

4. **Start the server**
   ```bash
   npm start
   ```

5. **Open in browser**
   ```
   http://localhost:3000
   ```

---

## 📁 Project Structure

```
Railway Radar/
├── server.js              # Express backend (API server)
├── app.js                 # Frontend JavaScript (map, search, UI)
├── index.html             # Main HTML page
├── styles.css             # CSS styling
├── package.json           # Node.js dependencies
├── .env.example           # Environment variables template
├── .gitignore             # Git ignore rules
├── README.md              # This file
├── ARCHITECTURE_REVIEW.md # Detailed technical review
└── assets/                # Static assets
```

---

## 🔧 Development

### Run in development mode (with auto-restart)
```bash
npm run dev
```

### Available Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon
- `npm test` - Run tests (not yet implemented)

---

## 🌐 API Endpoints

| Method | Endpoint         | Description                          |
|--------|------------------|--------------------------------------|
| GET    | `/api/trains`    | Fetch live train data from Darwin    |
| GET    | `/api/stations`  | Get list of UK railway stations      |
| GET    | `/api/health`    | Server health check                  |

### Example Response

**GET `/api/trains`**
```json
{
  "trains": [
    {
      "id": "TR001",
      "name": "1A23",
      "lat": 51.5307,
      "lng": -0.1234,
      "station": "London King's Cross",
      "destination": "Edinburgh Waverley",
      "originCode": "KGX",
      "destinationCode": "EDB",
      "operator": "LNER",
      "status": "On Time"
    }
  ],
  "timestamp": "2026-02-09T10:30:00.000Z"
}
```

---

## 🔐 Environment Variables

| Variable                 | Description                    | Default      |
|--------------------------|--------------------------------|--------------|
| `AWS_ACCESS_KEY_ID`      | AWS access key                 | Required     |
| `AWS_SECRET_ACCESS_KEY`  | AWS secret key                 | Required     |
| `AWS_REGION`             | AWS region                     | `eu-west-1`  |
| `PORT`                   | Server port                    | `3000`       |
| `NODE_ENV`               | Environment (dev/production)   | `development`|
| `CACHE_TTL`              | Cache duration (milliseconds)  | `60000`      |

---

## 🛠️ Technologies Used

### Backend
- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **AWS SDK** - S3 access for Darwin data
- **xml2js** - XML parsing
- **Helmet** - Security headers
- **express-rate-limit** - API rate limiting
- **CORS** - Cross-origin resource sharing

### Frontend
- **Leaflet.js** - Interactive maps
- **OpenStreetMap** - Map tiles
- **Vanilla JavaScript** - No framework dependencies

---

## 🐛 Troubleshooting

### "Failed to fetch" error

**Cause:** Server not running or AWS credentials invalid

**Solution:**
1. Ensure server is running: `npm start`
2. Check `.env` file has valid AWS credentials
3. Verify AWS credentials have S3 read access
4. Check browser console for detailed error messages

### No trains appearing

**Cause:** Darwin S3 bucket may be empty or XML parsing failed

**Solution:**
1. Check server logs for parsing errors
2. Verify S3 bucket has timetable files
3. Try refreshing the page after 60 seconds

### Geolocation not working

**Cause:** Browser denied location access

**Solution:**
1. Enable location permissions in browser settings
2. Use HTTPS in production (required for geolocation)

---

## 🔒 Security

- ✅ Helmet.js for security headers
- ✅ Rate limiting on API endpoints
- ✅ Environment variable validation
- ✅ CORS configuration
- ⚠️ Add HTTPS in production
- ⚠️ Consider adding authentication for admin features

---

## 📈 Performance

- **Caching:** 60-second in-memory cache reduces S3 API calls
- **Rate Limiting:** 100 requests per 15 minutes per IP
- **Compression:** Gzip compression enabled
- **CDN:** Consider using CloudFront for static assets

---

## 🚧 Known Issues

- Station database is hardcoded (should be in database)
- Polling-based refresh (should use WebSockets)
- No historical data storage
- Limited error recovery

See [ARCHITECTURE_REVIEW.md](ARCHITECTURE_REVIEW.md) for comprehensive analysis.

---

## 🗺️ Roadmap

- [ ] Add database (MongoDB/PostgreSQL)
- [ ] Implement WebSocket for real-time updates
- [ ] Add user authentication
- [ ] Save favorite trains/routes
- [ ] Email/SMS notifications
- [ ] Analytics dashboard
- [ ] Mobile app (React Native)
- [ ] Add unit and integration tests

---

## 📄 License

ISC License - see LICENSE file for details

---

## 🙏 Acknowledgments

- **National Rail** for Darwin timetable data
- **OpenStreetMap** contributors for map tiles
- **Leaflet.js** for the mapping library

---

## 📞 Support

For issues and questions:
1. Check [ARCHITECTURE_REVIEW.md](ARCHITECTURE_REVIEW.md)
2. Review browser console logs
3. Check server logs in terminal

---

**Built with ❤️ for railway enthusiasts**
const express = require('express')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const app = express()
const PORT = process.env.PORT || 3000

// --- 1. MIDDLEWARE ---

app.use(express.urlencoded({ extended: true }))

// Request Logger
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`)
  next()
})

// Helper: Cookie Parser
const getCookie = (req, name) => {
  if (!req.headers.cookie) return null;
  const match = req.headers.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}

// Serve Pico CSS
app.use('/pico', express.static(path.join(__dirname, 'node_modules/@picocss/pico/css')))
// Serve Public folder
app.use('/public', express.static(path.join(__dirname, 'public')))

// Serve Images
app.get('/images/:filename', (req, res) => {
  const filename = req.params.filename
  if (!filename.match(/\.(jpg|jpeg|png|gif|webp)$/i)) return res.status(404).send('Not an image')
  const filepath = path.join(__dirname, 'room resources', filename)
  if (fs.existsSync(filepath)) res.sendFile(filepath)
  else res.status(404).send('Image not found')
})

// --- 2. STATE & CONFIG ---

const reservations = []

// Token storage for token-based auth
// Maps token -> { username, createdAt }
const tokenStore = new Map()

// Cookie session tracking
// Maps username -> last seen timestamp
const cookieSessions = new Map()

// GLOBAL CONFIG
let config = {
  delays: { login: 0, menu: 0, reserve: 0, overview: 0, rooms: 0 },
  errorRate: 0,
  // Default is now 'cookie' (easiest for recording)
  authMode: 'cookie' 
}

// LOAD ROOMS
let roomTypes = []
try {
  const data = fs.readFileSync(path.join(__dirname, 'rooms.json'), 'utf8')
  roomTypes = JSON.parse(data)
  console.log(`✅ Loaded ${roomTypes.length} room types from rooms.json`)
} catch (err) {
  console.error("❌ Error loading rooms.json:", err.message)
  roomTypes = [] 
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const escapeHtml = (unsafe) => {
  if (!unsafe) return ""
  return unsafe
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;")
}

// --- DATE VALIDATION HELPER ---
const isValidDate = (dateString) => {
  // Check format YYYY-MM-DD
  const regex = /^\d{4}-\d{2}-\d{2}$/
  if (!regex.test(dateString)) return false
  
  // Check if it's a valid date
  const date = new Date(dateString)
  if (isNaN(date.getTime())) return false
  
  // Check if the date matches the input (prevents invalid dates like 2026-02-30)
  const [year, month, day] = dateString.split('-').map(Number)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return false
  }
  
  return true
}

// --- TOKEN HELPERS ---
const generateToken = (username) => {
  // Create a token that includes username (base64) + random data
  // Format: base64(username) + "." + random hex (16 bytes)
  const userPart = Buffer.from(username).toString('base64')
  const randomPart = crypto.randomBytes(16).toString('hex')
  return `${userPart}.${randomPart}`
}

const getUserFromToken = (token) => {
  if (!token) return null
  
  // Check if token exists in store
  const tokenData = tokenStore.get(token)
  if (tokenData) return tokenData.username
  
  return null
}

const storeToken = (token, username) => {
  tokenStore.set(token, {
    username: username,
    createdAt: new Date()
  })
  console.log(`✅ Token created for user: ${username} (Total active tokens: ${tokenStore.size})`)
}

const invalidateToken = (token) => {
  if (token && tokenStore.has(token)) {
    const tokenData = tokenStore.get(token)
    tokenStore.delete(token)
    console.log(`🗑️  Token invalidated for user: ${tokenData.username}`)
    return true
  }
  return false
}

const clearAllTokens = () => {
  const count = tokenStore.size
  tokenStore.clear()
  console.log(`🗑️  Cleared ${count} tokens`)
}

// --- COOKIE SESSION HELPERS ---
const updateCookieSession = (username) => {
  cookieSessions.set(username, new Date())
}

const removeCookieSession = (username) => {
  if (username && cookieSessions.has(username)) {
    cookieSessions.delete(username)
    console.log(`🗑️  Cookie session removed for user: ${username}`)
  }
}

const clearAllCookieSessions = () => {
  const count = cookieSessions.size
  cookieSessions.clear()
  console.log(`🗑️  Cleared ${count} cookie sessions`)
}

// --- URL BUILDER HELPER ---
const makeLink = (path, user, token) => {
  if (config.authMode === 'token' && token) {
    const separator = path.includes('?') ? '&' : '?'
    return `${path}${separator}token=${encodeURIComponent(token)}`
  }
  return path
}

const makeLinkWithRoom = (baseLink, roomName) => {
  const separator = baseLink.includes('?') ? '&amp;' : '?'
  return `${baseLink}${separator}room=${encodeURIComponent(roomName)}`
}

// --- AUTH MIDDLEWARE ---
app.use((req, res, next) => {
  let user = null;
  let token = null;

  // 1. COOKIE MODE (Default)
  if (config.authMode === 'cookie') {
    user = getCookie(req, 'username');
    if (user) {
      updateCookieSession(user)
    }
  } 
  // 2. TOKEN MODE (For Correlation Exercises)
  else if (config.authMode === 'token') {
    token = (req.query && req.query.token) || (req.body && req.body.token) || null;
    user = getUserFromToken(token);
  }
  
  req.user = user;
  req.token = token;
  req.makeLink = (path) => makeLink(path, user, token);
  next();
})

// Check availability helper
const isRoomAvailable = (roomName, checkInDate, nights) => {
  const newStart = new Date(checkInDate).getTime()
  const newEnd = newStart + (nights * 24 * 60 * 60 * 1000)
  const roomReservations = reservations.filter(r => r.room === roomName)

  for (const r of roomReservations) {
    const rStart = new Date(r.checkIn).getTime()
    const rEnd = rStart + (r.nights * 24 * 60 * 60 * 1000)
    if (newStart < rEnd && newEnd > rStart) return false 
  }
  return true
}

// --- 3. CHAOS MONKEY ---
app.use((req, res, next) => {
  if (req.path.startsWith('/config')) return next()
  if (config.errorRate > 0 && Math.random() * 100 < config.errorRate) {
    return res.status(500).send("<h3>🔥 500 Internal Server Error</h3><p>Simulated failure (Chaos Mode)</p>")
  }
  next()
})

// --- 4. LAYOUT ---
const layout = (title, body, req) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} • Hotel The Apex Drift (TAD)</title>
  <link rel="stylesheet" href="/pico/pico.min.css" />
  <link rel="stylesheet" href="/public/flatpickr/flatpickr.min.css">
  <style>
    header.hero { background: linear-gradient(135deg, #0f766e, #0ea5a4); color: white; padding: 2rem 1rem; border-radius: 0 0 1.5rem 1.5rem; margin-bottom: 2.5rem; }
    header.hero h1, header.hero p { color: white; margin-bottom: 0; }
    .user-display { background: rgba(255,255,255,0.2); padding: 0.25rem 0.75rem; border-radius: 99px; font-size: 0.9rem; }
    .badge { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.35rem 0.65rem; border-radius: 999px; background: var(--pico-muted-border-color); font-size: 0.85em; }
    .table-wrap { overflow-x: auto; }
    .image-stack { display: flex; flex-direction: column; gap: 2rem; margin-bottom: 2rem; }
    .full-width-image { width: 100%; height: auto; border-radius: 4px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); display: block; }
    .list-thumbnail { width: 100%; height: 250px; object-fit: cover; border-radius: 4px; background-color: #eee; }
    .img-placeholder { width: 100%; height: 250px; background-color: #f0f0f0; display: flex; align-items: center; justify-content: center; color: #666; border-radius: 4px; border: 2px dashed #ccc; font-size: 0.9rem; }
    [data-tooltip] { border-bottom: 1px dotted white; cursor: help; }
    .feature-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.5rem; margin-bottom: 1rem; }
    .feature-tag { font-size: 0.8rem; background: var(--pico-card-background-color); padding: 0.3rem 0.5rem; border: 1px solid var(--pico-muted-border-color); border-radius: 4px; text-align: center; }
    .details-section { margin-bottom: 2rem; border-bottom: 1px solid var(--pico-muted-border-color); padding-bottom: 1rem; }
    .details-section:last-child { border-bottom: none; }
    h4 { color: var(--pico-primary); margin-bottom: 0.5rem; font-size: 1.1rem; }
    ul.compact { padding-left: 1.2rem; margin-bottom: 0.5rem; }
    .header-logo { height: 80px; width: auto; display: block; margin: 1rem auto 0; }
    .header-content { text-align: center; }
    .token-preview { font-family: monospace; font-size: 0.75rem; color: var(--pico-muted-color); overflow: hidden; text-overflow: ellipsis; max-width: 250px; }
    .hidden-link { position: fixed; bottom: 0; right: 0; width: 5px; height: 5px; opacity: 0; z-index: 9999; }
  </style>
</head>
<body>
  <header class="hero container">
    <nav>
      <ul>
        <li>
          <div class="header-content">
            <hgroup>
              <h1 style="font-size:1.5rem; margin-bottom:0;">Hotel The Apex Drift (TAD)</h1>
              <p style="font-size:0.9rem;">Where Load Meets Luxury</p>
            </hgroup>
            <img src="/public/TAD2026.png" alt="TAD Logo" class="header-logo" />
          </div>
        </li>
      </ul>
      <ul>
        ${req.user ? `<li><span class="user-display">👤 ${req.user}</span></li>` : ''}
      </ul>
    </nav>
  </header>
  <main class="container">
    ${body}
  </main>
  <footer class="container" style="margin-top:3rem; text-align:center; opacity:0.75; padding-bottom: 2rem;">
    <small>Scalable Performance Testing with JMeter</small>
  </footer>
  <a href="/config" class="hidden-link" aria-label="Config"></a>
  <script src="/public/flatpickr/flatpickr.min.js"></script>
</body>
</html>
`

// --- 5. ROUTES ---

app.get('/', async (req, res) => {
  await sleep(config.delays.login)
  
  if (req.user) return res.redirect(req.makeLink('/menu'))

  res.send(layout('Login', ``+`
    <article>
      <header><strong>Welcome</strong></header>
      <p>Please log in to manage reservations.</p>
      <form action="/login" method="POST">
        <label>Username <input name="username" placeholder="Username" required /></label>
        <label>Password <input type="password" name="password" placeholder="Password" required /></label>
        <button type="submit">Login</button>
      </form>
      <small style="color:grey; font-size:0.8em">Auth Mode: <strong>${config.authMode.toUpperCase()}</strong></small>
    </article>
  `, req))
})

app.post('/login', async (req, res) => {
  await sleep(100)
  const { username, password } = req.body
  
  let valid = false
  if (username === 'admin' && password === 'password') valid = true
  const userMatch = username.match(/^user(\d+)$/)
  if (userMatch && password === `Password${userMatch[1]}`) valid = true

  if (valid) {
    if (config.authMode === 'cookie') {
      res.cookie('username', username, { httpOnly: true })
      updateCookieSession(username)
      return res.redirect('/menu')
    } 
    else if (config.authMode === 'token') {
      // Generate a secure token
      const token = generateToken(username)
      storeToken(token, username)
      return res.redirect(`/menu?token=${encodeURIComponent(token)}`)
    }
  }

  res.send(layout('Login Failed', ``+`
    <article style="border-color: red;">
      <h3>❌ Login Failed</h3>
      <p>Invalid credentials.</p>
      <p style="margin-top:1rem; padding:1rem; background:var(--pico-card-background-color); border-radius:4px;">
        <strong>💡 Hint:</strong> Valid credentials follow the pattern <code>user&lt;number&gt;</code> with password <code>Password&lt;same-number&gt;</code>.
      </p>
      <a href="/" role="button" class="secondary">Try Again</a>
    </article>
  `, req))
})

app.get('/logout', (req, res) => {
  // Remove cookie session tracking
  if (req.user) {
    removeCookieSession(req.user)
  }
  
  // Clear cookie regardless of mode (doesn't hurt)
  res.clearCookie('username')
  
  // Invalidate token if in token mode
  if (config.authMode === 'token' && req.token) {
    invalidateToken(req.token)
  }
  
  res.redirect('/')
})

app.get('/menu', async (req, res) => {
  if (!req.user) return res.redirect('/') 
  await sleep(config.delays.menu)
  
  res.send(layout('Main Menu', ``+`
    <h2>Main Menu</h2>
    <p>Welcome back, <strong>${req.user}</strong>.</p>
    <div class="grid">
      <a href="${req.makeLink('/rooms')}" role="button" class="contrast">🏨 View Rooms</a>
      <a href="${req.makeLink('/reserve')}" role="button">📅 Make a Reservation</a>
    </div>
    <div class="grid" style="margin-top: 1rem;">
      <a href="${req.makeLink('/overview')}" role="button" class="secondary">📋 View Booked Rooms</a>
      <a href="/logout" role="button" class="outline">Logout</a>
    </div>
  `, req))
})

// --- ROOMS LIST ---
app.get('/rooms', async (req, res) => {
  if (!req.user) return res.redirect('/')
  await sleep(config.delays.rooms)
  const cards = roomTypes.map(room => {
    let imgHtml = ''
    if (room.media && room.media.photos && room.media.photos.length > 0) {
       const safeFilename = encodeURIComponent(room.media.photos[0])
       imgHtml = `<img src="/images/${safeFilename}" alt="${room.room_name}" class="list-thumbnail" />`
    } else {
       imgHtml = `<div class="img-placeholder"><span>No Image Available</span></div>`
    }
    return ``+`
    <article>
      <header>
        <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong>${room.room_name}</strong>
            <span class="badge">${room.category}</span>
        </div>
      </header>
      ${imgHtml}
      <p style="margin-top:1rem;">${room.description}</p>
      <div style="font-size:0.9em; margin-bottom:1rem; color: var(--pico-muted-color);">
        <span>📐 ${room.size.value} ${room.size.unit}</span> &bull; 
        <span>👥 Max ${room.occupancy.max_guests} Guests</span>
      </div>
      <footer>
        <div class="grid">
           <button class="outline" disabled>€${room.pricing.base_price_per_night} /night</button>
           <a href="${req.makeLink('/rooms/' + room.room_id)}" role="button">View Details</a>
        </div>
      </footer>
    </article>
  `}).join('')

  res.send(layout('Our Rooms', ``+`
    <h2>Our Accommodations</h2>
    <div class="grid">${cards}</div>
    <div style="margin-top:2rem;">
      <a href="${req.makeLink('/menu')}" role="button" class="secondary">Back to Menu</a>
    </div>
  `, req))
})

// --- ROOM DETAILS ---
app.get('/rooms/:id', async (req, res) => {
  if (!req.user) return res.redirect('/')
  const room = roomTypes.find(r => r.room_id === req.params.id)
  if (!room) return res.redirect(req.makeLink('/rooms'))
  await sleep(config.delays.rooms)

  let mediaHtml = ''
  if (room.media && room.media.photos && room.media.photos.length > 0) {
     const images = room.media.photos.map(photo => {
         const safeName = encodeURIComponent(photo)
         return `<img src="/images/${safeName}" alt="${room.room_name}" class="full-width-image" />`
     }).join('')
     mediaHtml = `<div class="image-stack">${images}</div>`
  } else {
     mediaHtml = `<div class="img-placeholder">No Images Available</div>`
  }

  const am = room.amenities || {}
  const tech = am.technology || {}
  const bath = room.bathroom || {}
  const safe = room.safety || {}
  const access = room.accessibility || {}
  const rules = room.house_rules || {}

  res.send(layout(room.room_name, ``+`
    <article>
      <header>
        <hgroup>
          <h2>${room.room_name}</h2>
          <p>€${room.pricing.base_price_per_night} <small class="muted">per night (excl. tax)</small></p>
        </hgroup>
        <div style="margin-top:0.5rem">
             <span class="badge">⭐ ${room.guest_feedback.average_rating}/5</span>
             <span class="badge">${room.view.type} View</span>
             <span class="badge">Floor ${room.view.floor_range}</span>
        </div>
      </header>
      ${mediaHtml}
      <p><strong>${room.description}</strong></p>
      
      <div class="grid details-section">
         <div>
            <h4>Overview</h4>
            <ul class="compact">
               <li><strong>Size:</strong> ${room.size.value} ${room.size.unit}</li>
               <li><strong>Max Guests:</strong> ${room.occupancy.max_guests}</li>
            </ul>
         </div>
         <div>
            <h4>Sleeping Arrangements</h4>
            <ul class="compact">
               ${room.beds.map(b => `<li>🛏️ ${b.quantity}x ${b.type} (${b.dimensions})</li>`).join('')}
            </ul>
         </div>
      </div>
      
      <div class="details-section">
        <h4>Amenities</h4>
        <div class="feature-list">
            ${tech.wifi?.available ? `<span class="feature-tag">📶 WiFi (${tech.wifi.speed_mbps} Mbps)</span>` : ''}
            ${am.climate_control?.air_conditioning ? `<span class="feature-tag">❄️ A/C</span>` : ''}
            ${am.food_and_drink?.coffee_machine ? `<span class="feature-tag">☕ Coffee Machine</span>` : ''}
            ${am.furnishing?.safe?.available ? `<span class="feature-tag">🔒 Safe</span>` : ''}
        </div>
      </div>

      <footer>
        <div class="grid">
           <a href="${makeLinkWithRoom(req.makeLink('/reserve'), room.room_name)}" role="button">Book This Room</a>
           <a href="${req.makeLink('/rooms')}" role="button" class="secondary outline">Back to List</a>
        </div>
      </footer>
    </article>
  `, req))
})

// --- RESERVE PAGE ---
app.get('/reserve', async (req, res) => {
  if (!req.user) return res.redirect('/')
  await sleep(config.delays.reserve)
  const selectedRoomId = req.query.room || ''
  
  const options = roomTypes.map(r => {
    const isSelected = r.room_name === selectedRoomId ? 'selected' : ''
    return `<option value="${r.room_name}" ${isSelected}>${r.room_name} (€${r.pricing.base_price_per_night})</option>`
  }).join('')

  const allReservations = JSON.stringify(reservations)
  const formAction = req.makeLink('/reserve')

  res.send(layout('Make Reservation', ``+`
    <h2>Book your stay</h2>
    <form action="${formAction}" method="POST">
      <div class="grid">
        <label>Guest name <input name="guest" value="${req.user}" required /></label>
        <label>Room type 
          <select name="room" id="roomSelect">
            ${options}
          </select>
        </label>
      </div>
      <div class="grid">
        <label>Check-in Date 
           <input type="text" id="checkInDate" name="checkIn" placeholder="Select Date" required />
        </label>
        <label>Nights 
           <input type="number" name="nights" value="1" min="1" max="14" required />
        </label>
      </div>
      <div style="margin-top: 1rem;">
        <button type="submit">Confirm Booking</button>
        <a href="${req.makeLink('/menu')}" role="button" class="secondary outline">Cancel</a>
      </div>
      ${config.authMode === 'token' && req.token ? `<input type="hidden" name="token" value="${req.token}" />` : ''}
    </form>

    <script>
      const existingReservations = ${allReservations};
      const roomSelect = document.getElementById('roomSelect');
      const checkInInput = document.getElementById('checkInDate');
      let fpInstance;
      
      function getBlockedDates(roomName) {
        const blocked = [];
        existingReservations.forEach(r => {
          if (r.room === roomName) {
            const fromDate = new Date(r.checkIn);
            const toDate = new Date(fromDate);
            toDate.setDate(toDate.getDate() + r.nights - 1);
            blocked.push({ from: fromDate.toISOString().split('T')[0], to: toDate.toISOString().split('T')[0] });
          }
        });
        return blocked;
      }
      
      function initPicker() {
        const selectedRoom = roomSelect.value;
        const disabledDates = getBlockedDates(selectedRoom);
        if(fpInstance) fpInstance.destroy();
        fpInstance = flatpickr("#checkInDate", { 
          minDate: "today", 
          disable: disabledDates, 
          dateFormat: "Y-m-d"
        });
      }
      
      // Initialize immediately on page load
      roomSelect.addEventListener('change', initPicker);
      
      // Wait for DOM to be fully ready, then initialize
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPicker);
      } else {
        initPicker();
      }
    </script>
  `, req))
})

app.post('/reserve', async (req, res) => {
  if (!req.user) return res.redirect('/')
  await sleep(config.delays.reserve)
  const { guest, room, nights, checkIn } = req.body

  if (!guest || !room || !checkIn) {
    return res.status(400).send(layout('Booking Error', ``+`
      <article style="border-color: red;">
        <h3>❌ Missing Information</h3>
        <p>Please provide all required booking information.</p>
        <a href="${req.makeLink('/reserve')}" role="button" class="secondary">Try Again</a>
      </article>
    `, req))
  }

  // Validate date format
  if (!isValidDate(checkIn)) {
    return res.status(400).send(layout('Booking Error', ``+`
      <article style="border-color: red;">
        <h3>❌ Invalid Date Format</h3>
        <p>Check-in date must be in format YYYY-MM-DD (e.g., 2026-01-23).</p>
        <p>You provided: <code>${escapeHtml(checkIn)}</code></p>
        <a href="${req.makeLink('/reserve')}" role="button" class="secondary">Try Again</a>
      </article>
    `, req))
  }

  // Check if date is in the past
  const checkInDate = new Date(checkIn)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (checkInDate < today) {
    return res.status(400).send(layout('Booking Error', ``+`
      <article style="border-color: red;">
        <h3>❌ Invalid Date</h3>
        <p>Check-in date cannot be in the past.</p>
        <a href="${req.makeLink('/reserve')}" role="button" class="secondary">Try Again</a>
      </article>
    `, req))
  }

  const isAvailable = isRoomAvailable(room, checkIn, Number(nights));
  if (!isAvailable) {
    return res.status(409).send(layout('Booking Error', ``+`
      <article style="border-color: red;">
        <h3>❌ Room Unavailable</h3>
        <p>Sorry, <strong>${room}</strong> is already booked for these dates.</p>
        <a href="${req.makeLink('/reserve')}" role="button" class="secondary">Try Different Dates</a>
      </article>
    `, req));
  }

  reservations.push({
    id: reservations.length + 1,
    guest: escapeHtml(guest),
    room: escapeHtml(room),
    checkIn: checkIn, 
    nights: Number(nights) || 1,
    date: new Date().toLocaleTimeString(), 
    bookedBy: req.user
  })

  // Auto-truncate to prevent memory issues during load testing
  if (reservations.length > 2000) {
    reservations.shift() // Remove oldest reservation
  }

  res.redirect(req.makeLink('/overview'))
})

app.get('/overview', async (req, res) => {
  if (!req.user) return res.redirect('/')
  await sleep(config.delays.overview)
  const userReservations = reservations.filter(r => r.bookedBy === req.user)
  const rows = userReservations.length === 0
    ? `<tr><td colspan="6" style="text-align:center; padding: 2rem;" class="muted">No reservations found.</td></tr>`
    : userReservations.map(r => `
      <tr>
        <td>#${r.id}</td>
        <td><b>${r.guest}</b></td>
        <td>${r.room}</td>
        <td>${r.checkIn || 'N/A'}</td>
        <td>${r.nights}</td>
        <td>${r.date}</td>
      </tr>
    `).reverse().join('')
  res.send(layout('Overview', ``+`
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
      <h3>Current Bookings <span class="badge">${userReservations.length}</span></h3>
      <a href="${req.makeLink('/reserve')}" role="button" class="contrast outline" style="font-size:0.8rem;">+ New</a>
    </div>
    <div class="table-wrap">
      <table class="striped">
        <thead>
          <tr><th>ID</th><th>Guest</th><th>Type</th><th>Check-In</th><th>Nights</th><th>Booked At</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="margin-top:2rem;">
      <a href="${req.makeLink('/menu')}" role="button" class="secondary">Back to Menu</a>
    </div>
  `, req))
})

// --- CONFIG ---
app.get('/config', (_req, res) => {
  const { delays, errorRate, authMode } = config
  
  // Build reservations table
  const reservationRows = reservations.length === 0
    ? `<tr><td colspan="7" style="text-align:center; padding: 2rem;" class="muted">No reservations found.</td></tr>`
    : reservations.map(r => `
      <tr>
        <td>#${r.id}</td>
        <td><b>${r.guest}</b></td>
        <td>${r.room}</td>
        <td>${r.checkIn || 'N/A'}</td>
        <td>${r.nights}</td>
        <td>${r.date}</td>
        <td style="font-size:0.8em; color:grey;">${r.bookedBy || 'system'}</td>
      </tr>
    `).reverse().join('')
  
  // Build active sessions table based on auth mode
  let sessionsTable = ''
  
  if (authMode === 'cookie') {
    const sessionRows = cookieSessions.size === 0
      ? `<tr><td colspan="2" style="text-align:center; padding: 2rem;" class="muted">No active cookie sessions.</td></tr>`
      : Array.from(cookieSessions.entries()).map(([username, lastSeen]) => `
        <tr>
          <td><strong>${username}</strong></td>
          <td style="font-size:0.85em; color:grey;">${lastSeen.toLocaleString()}</td>
        </tr>
      `).join('')
    
    sessionsTable = `
      <section style="margin-top:2rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
          <h3>Active Cookie Sessions <span class="badge">${cookieSessions.size}</span></h3>
        </div>
        <div class="table-wrap">
          <table class="striped">
            <thead>
              <tr><th>Username</th><th>Last Seen</th></tr>
            </thead>
            <tbody>${sessionRows}</tbody>
          </table>
        </div>
      </section>
    `
  } else if (authMode === 'token') {
    const tokenRows = tokenStore.size === 0
      ? `<tr><td colspan="3" style="text-align:center; padding: 2rem;" class="muted">No active tokens.</td></tr>`
      : Array.from(tokenStore.entries()).map(([token, data]) => `
        <tr>
          <td><strong>${data.username}</strong></td>
          <td><span class="token-preview" title="${token}">${token.substring(0, 30)}...</span></td>
          <td style="font-size:0.85em; color:grey;">${data.createdAt.toLocaleString()}</td>
        </tr>
      `).join('')
    
    sessionsTable = `
      <section style="margin-top:2rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
          <h3>Active Tokens <span class="badge">${tokenStore.size}</span></h3>
        </div>
        <div class="table-wrap">
          <table class="striped">
            <thead>
              <tr><th>Username</th><th>Token (Preview)</th><th>Created At</th></tr>
            </thead>
            <tbody>${tokenRows}</tbody>
          </table>
        </div>
      </section>
    `
  }
  
  res.send(layout('Workshop Config', ``+`
    <article>
      <header><strong>⚙️ Simulation Configuration</strong></header>
      <form action="/config" method="POST">
        <div class="grid">
          <fieldset>
             <legend><strong>Authentication Method</strong></legend>
             <label>
                <input type="radio" name="authMode" value="cookie" ${authMode === 'cookie' ? 'checked' : ''} />
                <strong>Cookies</strong> [Default]
                <small style="display:block; color:grey">Standard Web Auth. Requires 'HTTP Cookie Manager' in JMeter. Works natively.</small>
             </label>
             <label>
                <input type="radio" name="authMode" value="token" ${authMode === 'token' ? 'checked' : ''} />
                <strong>URL Token</strong>
                <small style="display:block; color:grey">Advanced. Appends secure token to URLs. Requires Manual Correlation and Regular Expression Extractor.</small>
             </label>
          </fieldset>
          
          <fieldset>
             <legend><strong>Artificial Latency (ms)</strong></legend>
             <label>Login <input type="number" name="delay_login" value="${delays.login}" /></label>
             <label>Room Details <input type="number" name="delay_rooms" value="${delays.rooms}" /></label>
             <label>Reserve <input type="number" name="delay_reserve" value="${delays.reserve}" /></label>
          </fieldset>
          <fieldset>
             <legend>Chaos</legend>
             <label>Error Rate (%) <input type="number" name="errorRate" value="${errorRate}" /></label>
          </fieldset>
        </div>
        <button type="submit">Update Configuration</button>
        <a href="/" role="button" class="secondary outline" style="width:100%; text-align:center; margin-top:0.5rem;">Back to App</a>
      </form>
    </article>
    
    ${sessionsTable}
    
    <section style="margin-top:2rem;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
        <h3>All Bookings <span class="badge">${reservations.length}</span></h3>
      </div>
      <div class="table-wrap">
        <table class="striped">
          <thead>
            <tr><th>ID</th><th>Guest</th><th>Type</th><th>Check-In</th><th>Nights</th><th>Booked At</th><th>User</th></tr>
          </thead>
          <tbody>${reservationRows}</tbody>
        </table>
      </div>
    </section>
  `, { user: null }))
})

app.post('/config', (req, res) => {
  const previousAuthMode = config.authMode
  
  config.delays.login = Number(req.body.delay_login) || 0
  config.delays.reserve = Number(req.body.delay_reserve) || 0
  config.delays.rooms = Number(req.body.delay_rooms) || 0
  config.errorRate = Number(req.body.errorRate) || 0
  config.authMode = req.body.authMode || 'cookie'
  
  console.log('--- CONFIG UPDATED ---')
  console.log(config)
  
  // If auth mode changed, clear everything and redirect to login
  if (previousAuthMode !== config.authMode) {
    console.log(`Auth mode changed from ${previousAuthMode} to ${config.authMode} - logging out all users`)
    res.clearCookie('username')
    clearAllTokens()
    clearAllCookieSessions()
    return res.send(layout('Configuration Updated', ``+`
      <article>
        <header><strong>✅ Configuration Saved</strong></header>
        <p>Authentication mode has been changed to <strong>${config.authMode.toUpperCase()}</strong>.</p>
        <p>All users have been logged out. Please log in again with the new authentication method.</p>
        <div style="margin-top:1.5rem;">
          <a href="/" role="button">Go to Login</a>
          <a href="/config" role="button" class="secondary outline">Back to Config</a>
        </div>
      </article>
    `, { user: null }))
  }
  
  res.redirect('/config')
})

app.listen(PORT, () => console.log(`App running on port ${PORT}`))
const express = require('express')
const path = require('path')
const fs = require('fs')
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

// --- URL BUILDER HELPER ---
const makeLink = (path, user) => {
  if (config.authMode === 'token' && user) {
    const separator = path.includes('?') ? '&' : '?'
    return `${path}${separator}token=${user}`
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

  // 1. COOKIE MODE (Default)
  if (config.authMode === 'cookie') {
    user = getCookie(req, 'username');
  } 
  // 2. TOKEN MODE (For Correlation Exercises)
  else {
    user = req.query.token || req.body.token || null;
  }
  
  req.user = user;
  req.makeLink = (path) => makeLink(path, user);
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
  <title>${title} • Hotel Aurora</title>
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
    .img-placeholder { width: 100%; height: 250px; background-color: #f0f0f0; display: flex; align-items: center; justify-content: center; color: #666; border-radius: 4px; border: 2px dashed #ccc; }
    [data-tooltip] { border-bottom: 1px dotted white; cursor: help; }
    .feature-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.5rem; margin-bottom: 1rem; }
    .feature-tag { font-size: 0.8rem; background: var(--pico-card-background-color); padding: 0.3rem 0.5rem; border: 1px solid var(--pico-muted-border-color); border-radius: 4px; text-align: center; }
    .details-section { margin-bottom: 2rem; border-bottom: 1px solid var(--pico-muted-border-color); padding-bottom: 1rem; }
    .details-section:last-child { border-bottom: none; }
    h4 { color: var(--pico-primary); margin-bottom: 0.5rem; font-size: 1.1rem; }
    ul.compact { padding-left: 1.2rem; margin-bottom: 0.5rem; }
  </style>
</head>
<body>
  <header class="hero container">
    <nav>
      <ul>
        <li>
          <hgroup>
            <h1 style="font-size:1.5rem; margin-bottom:0;">Hotel Aurora</h1>
            <p style="font-size:0.9rem;">Workshop Demo App</p>
          </hgroup>
        </li>
      </ul>
      <ul>
        ${req.user ? `<li><span class="user-display">👤 ${req.user}</span> <small style="opacity:0.7">(${config.authMode})</small></li>` : ''}
      </ul>
    </nav>
  </header>
  <main class="container">
    ${body}
  </main>
  <footer class="container" style="margin-top:3rem; text-align:center; opacity:0.75; padding-bottom: 2rem;">
    <small>Node.js • Express • Pico.css</small>
  </footer>
  <script src="/public/flatpickr/flatpickr.min.js"></script>
</body>
</html>
`

// --- 5. ROUTES ---

app.get('/', async (req, res) => {
  await sleep(config.delays.login)
  
  if (req.user) return res.redirect(req.makeLink('/menu'))

  res.send(layout('Login', `
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
      return res.redirect('/menu')
    } 
    else if (config.authMode === 'token') {
      return res.redirect(`/menu?token=${username}`)
    }
  }

  res.send(layout('Login Failed', `
    <article style="border-color: red;">
      <h3>❌ Login Failed</h3>
      <p>Invalid credentials.</p>
      <a href="/" role="button" class="secondary">Try Again</a>
    </article>
  `, req))
})

app.get('/logout', (req, res) => {
  if (config.authMode === 'cookie') {
    res.clearCookie('username')
  }
  res.redirect('/')
})

app.get('/menu', async (req, res) => {
  if (!req.user) return res.redirect('/') 
  await sleep(config.delays.menu)
  
  res.send(layout('Main Menu', `
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
    return `
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

  res.send(layout('Our Rooms', `
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

  res.send(layout(room.room_name, `
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

  res.send(layout('Make Reservation', `
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
    </form>

    <script>
      const existingReservations = ${allReservations};
      const roomSelect = document.getElementById('roomSelect');
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
        fpInstance = flatpickr("#checkInDate", { minDate: "today", disable: disabledDates, dateFormat: "Y-m-d" });
      }
      roomSelect.addEventListener('change', initPicker);
      initPicker();
    </script>
  `, req))
})

app.post('/reserve', async (req, res) => {
  if (!req.user) return res.redirect('/')
  await sleep(config.delays.reserve)
  const { guest, room, nights, checkIn } = req.body

  if (!guest || !room || !checkIn) return res.status(400).send("Missing data")

  const isAvailable = isRoomAvailable(room, checkIn, Number(nights));
  if (!isAvailable) {
    return res.status(409).send(layout('Booking Error', `
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

  if (reservations.length > 2000) reservations.shift()
  res.redirect(req.makeLink('/overview'))
})

app.get('/overview', async (req, res) => {
  if (!req.user) return res.redirect('/')
  await sleep(config.delays.overview)
  const rows = reservations.length === 0
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
  res.send(layout('Overview', `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
      <h3>Current Bookings <span class="badge">${reservations.length}</span></h3>
      <a href="${req.makeLink('/reserve')}" role="button" class="contrast outline" style="font-size:0.8rem;">+ New</a>
    </div>
    <div class="table-wrap">
      <table class="striped">
        <thead>
          <tr><th>ID</th><th>Guest</th><th>Type</th><th>Check-In</th><th>Nights</th><th>Booked At</th><th>User</th></tr>
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
  res.send(layout('Workshop Config', `
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
                <small style="display:block; color:grey">Advanced. Appends ?token=user to URLs. Requires Manual Correlation.</small>
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
        <button type="submit">Update</button>
        <a href="/" role="button" class="secondary outline" style="width:100%; text-align:center;">Back to App</a>
      </form>
    </article>
  `, { user: null }))
})

app.post('/config', (req, res) => {
  config.delays.login = Number(req.body.delay_login) || 0
  config.delays.reserve = Number(req.body.delay_reserve) || 0
  config.delays.rooms = Number(req.body.delay_rooms) || 0
  config.errorRate = Number(req.body.errorRate) || 0
  config.authMode = req.body.authMode || 'cookie'
  
  console.log('--- CONFIG UPDATED ---')
  console.log(config)
  
  res.redirect('/config')
})

app.listen(PORT, () => console.log(`App running on port ${PORT}`))
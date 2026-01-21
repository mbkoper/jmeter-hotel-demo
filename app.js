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

// Authentication Middleware
app.use((req, res, next) => {
  req.user = getCookie(req, 'username') || null;
  next();
})

// Serve Pico CSS
app.use('/pico', express.static(path.join(__dirname, 'node_modules/@picocss/pico/css')))
// Serve Public folder
app.use('/public', express.static(path.join(__dirname, 'public')))

// --- SERVE IMAGES FROM 'room resources' FOLDER ---
app.get('/images/:filename', (req, res) => {
  const filename = req.params.filename
  if (!filename.match(/\.(jpg|jpeg|png|gif|webp)$/i)) return res.status(404).send('Not an image')
  const filepath = path.join(__dirname, 'room resources', filename)
  if (fs.existsSync(filepath)) res.sendFile(filepath)
  else res.status(404).send('Image not found')
})

// --- 2. STATE & CONFIG ---

const reservations = []
let config = {
  delays: { login: 0, menu: 0, reserve: 0, overview: 0, rooms: 0 },
  errorRate: 0
}

// LOAD ROOMS FROM JSON
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

// --- 3. CHAOS MONKEY ---
app.use((req, res, next) => {
  if (req.path.startsWith('/config')) return next()
  if (config.errorRate > 0 && Math.random() * 100 < config.errorRate) {
    return res.status(500).send("<h3>🔥 500 Internal Server Error</h3><p>Simulated failure (Chaos Mode)</p>")
  }
  next()
})

// --- 4. LAYOUT ---
const layout = (title, body, currentUser) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} • Hotel Aurora</title>
  <link rel="stylesheet" href="/pico/pico.min.css" />
  <style>
    header.hero {
      background: linear-gradient(135deg, #0f766e, #0ea5a4);
      color: white;
      padding: 2rem 1rem;
      border-radius: 0 0 1.5rem 1.5rem;
      margin-bottom: 2.5rem;
    }
    header.hero h1, header.hero p { color: white; margin-bottom: 0; }
    .user-display { background: rgba(255,255,255,0.2); padding: 0.25rem 0.75rem; border-radius: 99px; font-size: 0.9rem; }
    .badge { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.35rem 0.65rem; border-radius: 999px; background: var(--pico-muted-border-color); font-size: 0.85em; }
    .table-wrap { overflow-x: auto; }
    [data-tooltip] { border-bottom: 1px dotted white; cursor: help; }
    
    /* NEW STYLES: Full Width Stacked Images */
    .image-stack {
      display: flex;
      flex-direction: column;
      gap: 2rem; /* Space between images */
      margin-bottom: 2rem;
    }

    .full-width-image {
      width: 100%;
      height: auto; /* Natural height, no cropping/zooming */
      border-radius: 4px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      display: block;
    }
    
    /* Fallback placeholder */
    .img-placeholder {
      width: 100%;
      height: 250px;
      background-color: #f0f0f0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #666;
      border-radius: 4px;
      border: 2px dashed #ccc;
    }

    /* Thumbnail for List View (kept smaller) */
    .list-thumbnail {
      width: 100%;
      height: 250px;
      object-fit: cover;
      border-radius: 4px;
      background-color: #eee;
    }
    
    /* Feature Lists */
    .feature-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.5rem; margin-bottom: 1rem; }
    .feature-tag { font-size: 0.8rem; background: var(--pico-card-background-color); padding: 0.3rem 0.5rem; border: 1px solid var(--pico-muted-border-color); border-radius: 4px; text-align: center; }
    
    .details-section { margin-bottom: 2rem; border-bottom: 1px solid var(--pico-muted-border-color); padding-bottom: 1rem; }
    .details-section:last-child { border-bottom: none; }
    h4 { color: var(--pico-primary); margin-bottom: 0.5rem; font-size: 1.1rem; }
    ul.compact { padding-left: 1.2rem; margin-bottom: 0.5rem; }
    ul.compact li { margin-bottom: 0.2rem; }
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
        ${currentUser ? `<li><span class="user-display">👤 ${currentUser}</span></li>` : ''}
      </ul>
    </nav>
  </header>
  <main class="container">
    ${body}
  </main>
  <footer class="container" style="margin-top:3rem; text-align:center; opacity:0.75; padding-bottom: 2rem;">
    <small>Node.js • Express • Pico.css</small>
  </footer>
</body>
</html>
`

// --- 5. ROUTES ---

app.get('/', async (req, res) => {
  await sleep(config.delays.login)
  if (req.user) return res.redirect('/menu')
  res.send(layout('Login', `
    <article>
      <header><strong>Welcome</strong></header>
      <p>Please log in to manage reservations.</p>
      <form action="/login" method="POST">
        <label>Username <input name="username" placeholder="Username" required /></label>
        <label>Password <input type="password" name="password" placeholder="Password" required /></label>
        <button type="submit">Login</button>
      </form>
    </article>
  `, null))
})

app.post('/login', async (req, res) => {
  await sleep(100)
  const { username, password } = req.body
  if (username === 'admin' && password === 'password') {
    res.cookie('username', 'admin', { httpOnly: true })
    return res.redirect('/menu')
  }
  const userMatch = username.match(/^user(\d+)$/)
  if (userMatch) {
    const userId = userMatch[1]
    if (password === `Password${userId}`) {
      res.cookie('username', username, { httpOnly: true })
      return res.redirect('/menu')
    }
  }
  res.send(layout('Login Failed', `
    <article style="border-color: red;">
      <h3>❌ Login Failed</h3>
      <p>Invalid credentials.</p>
      <a href="/" role="button" class="secondary">Try Again</a>
    </article>
  `, null))
})

app.get('/logout', (req, res) => {
  res.clearCookie('username')
  res.redirect('/')
})

app.get('/menu', async (req, res) => {
  if (!req.user) return res.redirect('/') 
  await sleep(config.delays.menu)
  res.send(layout('Main Menu', `
    <h2>Main Menu</h2>
    <p>Welcome back, <strong>${req.user}</strong>.</p>
    <div class="grid">
      <a href="/rooms" role="button" class="contrast">🏨 View Rooms</a>
      <a href="/reserve" role="button">📅 Make a Reservation</a>
    </div>
    <div class="grid" style="margin-top: 1rem;">
      <a href="/overview" role="button" class="secondary">📋 View Booked Rooms</a>
      <a href="/logout" role="button" class="outline">Logout</a>
    </div>
  `, req.user))
})

// --- ROOMS LIST ---
app.get('/rooms', async (req, res) => {
  if (!req.user) return res.redirect('/')
  await sleep(config.delays.rooms)

  const cards = roomTypes.map(room => {
    let imgHtml = ''
    if (room.media && room.media.photos && room.media.photos.length > 0) {
       const safeFilename = encodeURIComponent(room.media.photos[0])
       // List view still uses the cropped thumbnail style for tidiness
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
           <a href="/rooms/${room.room_id}" role="button">View Details</a>
        </div>
      </footer>
    </article>
  `}).join('')

  res.send(layout('Our Rooms', `
    <h2>Our Accommodations</h2>
    <div class="grid">${cards}</div>
    <div style="margin-top:2rem;">
      <a href="/menu" role="button" class="secondary">Back to Menu</a>
    </div>
  `, req.user))
})

// --- ROOM DETAILS (UPDATED: Stacked Full Width Images) ---
app.get('/rooms/:id', async (req, res) => {
  if (!req.user) return res.redirect('/')
  
  const room = roomTypes.find(r => r.room_id === req.params.id)
  if (!room) return res.redirect('/rooms')

  await sleep(config.delays.rooms)

  // 1. Generate Stacked Image HTML
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

  // 2. Data Extraction Helpers
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
               <li><strong>Max Guests:</strong> ${room.occupancy.max_guests} (Ad: ${room.occupancy.adults}, Ch: ${room.occupancy.children})</li>
               <li><strong>Renovated:</strong> ${room.additional_notes.renovated_year}</li>
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
            ${tech.tv?.available ? `<span class="feature-tag">📺 ${tech.tv.size_inches}" TV</span>` : ''}
            ${am.climate_control?.air_conditioning ? `<span class="feature-tag">❄️ A/C</span>` : ''}
            ${am.food_and_drink?.coffee_machine ? `<span class="feature-tag">☕ Coffee Machine</span>` : ''}
            ${am.furnishing?.safe?.available ? `<span class="feature-tag">🔒 Safe</span>` : ''}
            ${am.comfort?.soundproofing ? `<span class="feature-tag">🔇 Soundproof</span>` : ''}
            ${am.comfort?.blackout_curtains ? `<span class="feature-tag">🌑 Blackout Curtains</span>` : ''}
            ${am.food_and_drink?.minibar?.available ? `<span class="feature-tag">🍸 Minibar</span>` : ''}
        </div>
      </div>

      <div class="grid details-section">
         <div>
            <h4>Bathroom</h4>
            <ul class="compact">
                <li><strong>Type:</strong> ${bath.type}</li>
                <li><strong>Shower:</strong> ${bath.shower}</li>
                <li><strong>Bathtub:</strong> ${bath.bathtub ? '✅ Yes' : '❌ No'}</li>
                <li><strong>Toiletries:</strong> ${bath.toiletries ? bath.toiletries.join(', ') : 'Standard'}</li>
            </ul>
         </div>
         <div>
            <h4>Housekeeping & Sustainability</h4>
            <ul class="compact">
                <li><strong>Cleaning:</strong> ${room.housekeeping.daily_cleaning ? 'Daily' : 'On Request'}</li>
                <li><strong>Linen:</strong> ${room.housekeeping.linen_change_policy}</li>
                <li><strong>Eco Certified:</strong> ${room.sustainability.eco_certified ? '🌿 Yes' : 'No'}</li>
                <li><strong>Energy Saving:</strong> ${room.sustainability.energy_saving_lighting ? '💡 Yes' : 'No'}</li>
            </ul>
         </div>
      </div>

      <div class="grid details-section">
         <div>
            <h4>House Rules</h4>
            <ul class="compact">
                <li><strong>Check-in:</strong> ${rules.check_in_time}</li>
                <li><strong>Check-out:</strong> ${rules.check_out_time}</li>
                <li><strong>Quiet Hours:</strong> ${rules.quiet_hours}</li>
                <li><strong>Pets:</strong> ${room.availability.pets.allowed ? `✅ Yes (€${room.availability.pets.fee_per_night})` : '❌ No'}</li>
            </ul>
         </div>
         <div>
            <h4>Safety & Access</h4>
            <ul class="compact">
                <li><strong>Wheelchair Access:</strong> ${access.wheelchair_accessible ? '✅ Yes' : '❌ No'}</li>
                <li><strong>Door Width:</strong> ${access.door_width_cm}cm</li>
                <li><strong>Smoke Detector:</strong> ${safe.smoke_detector ? '✅' : '❌'}</li>
                <li><strong>Electronic Key:</strong> ${safe.electronic_key_card ? '✅' : '❌'}</li>
            </ul>
         </div>
      </div>

      <div style="margin-top:1rem; padding:1rem; background: var(--pico-card-background-color); border-radius:8px;">
        <small><strong>Cancellation Policy:</strong> 
        ${room.pricing.cancellation_policy?.free_cancellation_until 
            ? `Free until ${new Date(room.pricing.cancellation_policy.free_cancellation_until).toLocaleDateString()}` 
            : 'Non-refundable'}. Penalty: ${room.pricing.cancellation_policy.penalty_after}</small>
      </div>

      <footer>
        <div class="grid">
           <a href="/reserve?room=${room.room_id}" role="button">Book This Room</a>
           <a href="/rooms" role="button" class="secondary outline">Back to List</a>
        </div>
      </footer>
    </article>
  `, req.user))
})

app.get('/reserve', async (req, res) => {
  if (!req.user) return res.redirect('/')
  await sleep(config.delays.reserve)
  const selectedRoomId = req.query.room || ''
  const options = roomTypes.map(r => {
    const isSelected = r.room_id === selectedRoomId ? 'selected' : ''
    return `<option value="${r.room_name}" ${isSelected}>${r.room_name} (€${r.pricing.base_price_per_night})</option>`
  }).join('')
  res.send(layout('Make Reservation', `
    <h2>Book your stay</h2>
    <form action="/reserve" method="POST">
      <div class="grid">
        <label>Guest name <input name="guest" value="${req.user}" required /></label>
        <label>Room type <select name="room">${options}</select></label>
      </div>
      <label>Nights <input type="number" name="nights" value="1" min="1" max="14" /></label>
      <div style="margin-top: 1rem;">
        <button type="submit">Confirm Booking</button>
        <a href="/menu" role="button" class="secondary outline">Cancel</a>
      </div>
    </form>
  `, req.user))
})

app.post('/reserve', async (req, res) => {
  if (!req.user) return res.redirect('/')
  await sleep(config.delays.reserve)
  const { guest, room, nights } = req.body
  if (!guest || !room) return res.status(400).send("Missing data")
  reservations.push({
    id: reservations.length + 1,
    guest: escapeHtml(guest),
    room: escapeHtml(room),
    nights: Number(nights) || 1,
    date: new Date().toLocaleTimeString(),
    bookedBy: req.user
  })
  if (reservations.length > 2000) reservations.shift()
  res.redirect('/overview')
})

app.get('/overview', async (req, res) => {
  if (!req.user) return res.redirect('/')
  await sleep(config.delays.overview)
  const rows = reservations.length === 0
    ? `<tr><td colspan="6" style="text-align:center; padding: 2rem;" class="muted">No reservations found.</td></tr>`
    : reservations.map(r => `
      <tr>
        <td>#${r.id}</td>
        <td><b>${r.guest}</b></td>
        <td>${r.room}</td>
        <td>${r.nights}</td>
        <td>${r.date}</td>
        <td style="font-size:0.8em; color:grey;">${r.bookedBy || 'system'}</td>
      </tr>
    `).reverse().join('')
  res.send(layout('Overview', `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
      <h3>Current Bookings <span class="badge">${reservations.length}</span></h3>
      <a href="/reserve" role="button" class="contrast outline" style="font-size:0.8rem;">+ New</a>
    </div>
    <div class="table-wrap">
      <table class="striped">
        <thead>
          <tr><th>ID</th><th>Guest</th><th>Type</th><th>Nights</th><th>Time</th><th>User</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="margin-top:2rem;">
      <a href="/menu" role="button" class="secondary">Back to Menu</a>
    </div>
  `, req.user))
})

app.get('/config', (_req, res) => {
  const { delays, errorRate } = config
  res.send(layout('Workshop Config', `
    <article>
      <header><strong>⚙️ Simulation Configuration</strong></header>
      <form action="/config" method="POST">
        <div class="grid">
          <fieldset>
             <legend>Latency (ms)</legend>
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
        <a href="/menu" role="button" class="secondary outline" style="width:100%; text-align:center;">Back to App</a>
      </form>
    </article>
  `, null))
})

app.post('/config', (req, res) => {
  config.delays.login = Number(req.body.delay_login) || 0
  config.delays.reserve = Number(req.body.delay_reserve) || 0
  config.delays.rooms = Number(req.body.delay_rooms) || 0
  config.errorRate = Number(req.body.errorRate) || 0
  res.redirect('/config')
})

app.listen(PORT, () => console.log(`App running on port ${PORT}`))
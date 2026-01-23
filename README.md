# Hotel The Apex Drift (TAD) - JMeter Workshop Demo

A purpose-built Node.js application designed to teach **Performance Testing** and **JMeter** concepts. This application mimics a real-world hotel booking system but includes hidden controls to simulate performance bottlenecks, server failures, and advanced correlation scenarios.

## Workshop Features

This app is designed to help students practice:
* **Correlation:** Dynamic handling of user sessions via Cookies or URL Tokens.
* **Assertions:** Predictable HTML responses and intentionally triggered errors.
* **Load Testing:** Simulating high traffic on critical paths (`/reserve`).
* **Chaos Engineering:** Configurable "Chaos Mode" to randomly throw HTTP 500 errors.
* **Latency Injection:** Manually add delay to specific endpoints to simulate slow backend responses.

## Getting Started

### Option 1: Run via Docker (Recommended)
The app is designed to run in a container for easy distribution to students.

```bash
# Build the image
docker build -t hotel-tad .

# Run the container (Access at localhost:3000)
docker run -p 3000:3000 hotel-tad
```

### Option 2: Run Locally

1. Ensure you have Node.js installed.
2. Install dependencies:
```bash
npm install
```

3. Download necessary assets (Flatpickr) to `public/`:
*(Ensure `public/flatpickr` exists with css/js files)*
4. Start the app:
```bash
npm start
```


## Application Logic

### Authentication & Credentials

* **Pattern:** `user<ID>` / `Password<ID>`
* **Examples:**
  * `user1` / `Password1`
  * `user500` / `Password500`

* **Admin:** `admin` / `password` (Access to all areas)

### Configuration & Auth Modes

Accessible at: `http://localhost:3000/config`

This page allows the instructor to control the environment. You can switch between **two authentication modes** to teach different JMeter concepts:

1. **Cookies [DEFAULT]:**
   * Standard web session behavior.
   * **JMeter Lesson:** Requires an *HTTP Cookie Manager* to record and replay correctly.
   * *Why?* Simplest "happy path" for beginners.

2. **URL Token:**
   * Appends `?token=userX` to every URL.
   * **JMeter Lesson:** Advanced **Correlation**. Students must extract the token from the login response (using a *Regular Expression Extractor*) and rewrite all subsequent links.


### Booking Constraints

* The app prevents double bookings for the same room on overlapping dates.
* Students must handle the date picker logic or backend validation errors (HTTP 409) in their scripts.

## Project Structure

* `app.js`: Main server logic.
* `rooms.json`: Data source for room details, pricing, and amenities.
* `room resources/`: Images served dynamically to the frontend.
* `public/`: Static assets (CSS, client-side JS).


# Hotel Aurora - JMeter Workshop Demo

A purpose-built Node.js application designed to teach **Performance Testing** and **JMeter** concepts. This application mimics a real-world hotel booking system but includes hidden controls to simulate performance bottlenecks and server failures.

## Workshop Features

This app is designed to help students practice:
* **Correlation:** Dynamic handling of user sessions (Cookies) and specific user flows.
* **Assertions:** Predictable HTML responses and intentionally triggered errors.
* **Load Testing:** Simulating high traffic on critical paths (`/reserve`).
* **Chaos Engineering:** Configurable "Chaos Mode" to randomly throw HTTP 500 errors.
* **Latency Injection:** Manually add delay to specific endpoints to simulate slow backend responses.

## Getting Started

### Option 1: Run via Docker (Recommended)
The app is designed to run in a container for easy distribution to students.

```bash
# Build the image
docker build -t hotel-aurora .

# Run the container (Access at localhost:3000)
docker run -p 3000:3000 hotel-aurora

```

### Option 2: Run Locally

1. Ensure you have Node.js installed.
2. Install dependencies:
```bash
npm install

```


3. Download necessary assets (Flatpickr) to `public/`:
*(See setup instructions in previous steps or ensure `public/flatpickr` exists)*
4. Start the app:
```bash
npm start

```



## Application Logic

### Authentication

* **Pattern:** `user<ID>` / `Password<ID>`
* **Examples:**
* `user1` / `Password1`
* `user500` / `Password500`


* **Admin:** `admin` / `password` (Access to all areas)

### The "Hidden" Config Page

Accessible at: `http://localhost:3000/config`

This page allows the instructor or student to control the environment variables of the running container:

* **Artificial Latency:** Add milliseconds of delay to Login, Search, or Booking actions.
* **Chaos Mode:** Set an error rate (0-100%) to trigger random HTTP 500 crashes.

### Booking Constraints

* The app prevents double bookings for the same room on overlapping dates.
* Students must handle the date picker logic or backend validation errors (HTTP 409) in their scripts.

## Project Structure

* `app.js`: Main server logic.
* `rooms.json`: Data source for room details, pricing, and amenities.
* `room resources/`: Images served dynamically to the frontend.
* `public/`: Static assets (CSS, client-side JS).

## Note for Workshops

To prevent server crashes during heavy load testing sessions, the in-memory reservation database automatically truncates itself (FIFO) when it exceeds 2,000 records.


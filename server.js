const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) {
  console.error('Set ADMIN_PASSWORD in the hosting service environment variables.');
  process.exit(1);
}

const assets = {
  gold: { name: 'Золото / XAUUSD', price: 2650, vol: 0.00065 },
  btc: { name: 'Bitcoin / BTCUSD', price: 92000, vol: 0.00135 },
  eth: { name: 'Ethereum / ETHUSD', price: 3100, vol: 0.0015 }
};
let asset = 'gold';
let price = assets[asset].price;
let initialPrice = price;
let candles = [];
let candle = { open: price, high: price, low: price, close: price, start: Date.now() };
let forceDirection = null;
let forceRemaining = 0;
let pendingDirection = null;

function seedHistory() {
  let p = price;
  candles = [];
  for (let i = 0; i < 39; i++) {
    const o = p;
    const c = o * (1 + (Math.random() - 0.5) * assets[asset].vol * 5);
    candles.push({ open:o, close:c, high:Math.max(o,c)*(1+Math.random()*assets[asset].vol), low:Math.min(o,c)*(1-Math.random()*assets[asset].vol) });
    p = c;
  }
  price = p;
  initialPrice = price;
  candle = { open:price, high:price, low:price, close:price, start:Date.now() };
}
seedHistory();

function snapshot() {
  return { asset, price, initialPrice, candles, candle, forceDirection, forceRemaining, pendingDirection, serverTime: Date.now() };
}
function broadcast() { io.emit('market-state', snapshot()); }
function safeEqual(a,b) {
  const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa,bb);
}

app.use(express.static('public'));
app.get('/health', (_req,res) => res.json({ ok:true, players:io.engine.clientsCount }));
io.on('connection', socket => {
  socket.emit('market-state', snapshot());
  socket.on('request-state', () => socket.emit('market-state', snapshot()));
  socket.on('verify-admin', (payload, reply) => {
    const ok = !!payload && safeEqual(payload.password || '', ADMIN_PASSWORD);
    if (typeof reply === 'function') reply({ ok, error: ok ? '' : 'Неверный пароль.' });
  });
  socket.on('admin-direction', (payload, reply) => {
    const direction = payload && payload.direction;
    if (!payload || !safeEqual(payload.password || '', ADMIN_PASSWORD)) {
      if (typeof reply === 'function') reply({ ok:false, error:'Неверный пароль администратора.' });
      return;
    }
    if (direction !== 'up' && direction !== 'down') {
      if (typeof reply === 'function') reply({ ok:false, error:'Неизвестное направление.' });
      return;
    }
    pendingDirection = direction;
    broadcast();
    if (typeof reply === 'function') reply({ ok:true });
  });
  socket.on('set-asset', next => {
    if (!Object.prototype.hasOwnProperty.call(assets,next)) return;
    asset = next;
    price = assets[asset].price;
    forceDirection = null; forceRemaining = 0; pendingDirection = null;
    seedHistory(); broadcast();
  });
});

setInterval(() => {
  const now = Date.now();
  const v = assets[asset].vol;
  let move;
  if (forceRemaining > 0 && forceDirection === 'up') move = (0.000045 + Math.random()*0.00010)*price + (Math.random()-0.5)*v*price*0.65;
  else if (forceRemaining > 0 && forceDirection === 'down') move = -(0.000045 + Math.random()*0.00010)*price + (Math.random()-0.5)*v*price*0.65;
  else move = (Math.random()-0.49)*v*price;
  price = Math.max(price*0.5, price+move);
  candle.close = price; candle.high = Math.max(candle.high,price); candle.low = Math.min(candle.low,price);
  if (now - candle.start >= 60000) {
    candles.push(candle); if (candles.length > 55) candles.shift();
    if (forceRemaining > 0) { forceRemaining--; if (forceRemaining === 0) forceDirection = null; }
    if (pendingDirection) { forceDirection = pendingDirection; forceRemaining = 1; pendingDirection = null; }
    candle = { open:price, high:price, low:price, close:price, start:now };
  }
  broadcast();
}, 500);

const host = '0.0.0.0';
server.listen(PORT, host, () => console.log(`Trading game listening on ${host}:${PORT}`));

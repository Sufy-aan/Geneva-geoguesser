// script.js — game logic

const API_KEY = 'AIzaSyBrPkaMdcHsp7t-1RbDYzQQXOFYrsEQmb8';

const TOTAL_ROUNDS = 5;
const MAX_SCORE_PER_ROUND = 1000;
const MAX_DIST_M = 3000;

// ---- TRANSLATIONS ----
const T = {
  en: {
    tagline: 'Know your neighbourhood?',
    chooseZone: 'Choose a zone',
    rounds: '5 rounds · up to 1000 pts each',
    easyMode: 'Easy mode (show hint circle)',
    startBtn: 'Start →',
    tutorialLink: 'How to play',
    score: 'Score',
    round: 'Round',
    placeGuess: 'Place your guess',
    nextRound: 'Next round →',
    seeResults: 'See results →',
    finalScore: 'Final score',
    outOf: 'out of 5000',
    playAgain: 'Play again →',
    mAway: 'm away',
    kmAway: 'km away',
    mOff: 'm off',
    kmOff: 'km off',
    loading: 'Loading Street View…',
  },
  fr: {
    tagline: 'Tu connais ton quartier ?',
    chooseZone: 'Choisir une zone',
    rounds: '5 manches · jusqu'à 1000 pts chacune',
    easyMode: 'Mode facile (afficher un indice)',
    startBtn: 'Commencer →',
    tutorialLink: 'Comment jouer',
    score: 'Score',
    round: 'Manche',
    placeGuess: 'Placer ma réponse',
    nextRound: 'Manche suivante →',
    seeResults: 'Voir les résultats →',
    finalScore: 'Score final',
    outOf: 'sur 5000',
    playAgain: 'Rejouer →',
    mAway: 'm de distance',
    kmAway: 'km de distance',
    mOff: 'm d\'écart',
    kmOff: 'km d\'écart',
    loading: 'Chargement Street View…',
  }
};

let lang = 'en';

function setLang(l) {
  lang = l;
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === l));
  applyTranslations();
}

function t(key) { return T[lang][key] || key; }

function applyTranslations() {
  // Static text elements
  document.getElementById('tagline').textContent = t('tagline');
  document.getElementById('zone-select-label').textContent = t('chooseZone');
  document.getElementById('rounds-label').textContent = t('rounds');
  document.getElementById('easy-mode-label').textContent = t('easyMode');
  document.getElementById('start-btn').textContent = t('startBtn');
  document.getElementById('tutorial-link').textContent = t('tutorialLink');
  document.getElementById('guess-btn').textContent = guessLatLng ? t('placeGuess') : t('placeGuess');
  document.getElementById('play-again-btn').textContent = t('playAgain');
  document.getElementById('final-title').textContent = t('finalScore');
  document.getElementById('final-max').textContent = t('outOf');
  document.getElementById('sv-loader-text').textContent = t('loading');

  // Zone select options
  const sel = document.getElementById('zone-select');
  Array.from(sel.options).forEach(opt => {
    const zone = ZONES[opt.value];
    if (zone) opt.textContent = zone.name[lang];
  });

  // HUD score/round labels (live)
  document.getElementById('hud-score-label').textContent = t('score') + ':';
  document.getElementById('hud-round-label').textContent = t('round');

  // Next btn if result screen is showing
  const isLast = round === TOTAL_ROUNDS - 1;
  document.getElementById('next-btn').textContent = isLast ? t('seeResults') : t('nextRound');
}

// ---- STATE ----
let currentZone = 'geneva';
let round = 0;
let totalScore = 0;
let roundScores = [];
let roundLocations = [];
let guessMarker = null;
let guessLatLng = null;
let panorama = null;
let guessMap = null;
let resultMap = null;
let mapsReady = false;
let easyMode = false;
let hintCircle = null;
let neighbourhoodPolygon = null;
let allNeighbourhoodPolygons = [];
let resultPolygons = [];

// ---- UTILS ----
function selectZone(zone) { currentZone = zone; }

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function haversineDistance(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const sa = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.asin(Math.sqrt(sa));
}

function scoreFromDistance(dist) {
  if (dist >= MAX_DIST_M) return 0;
  return Math.round(MAX_SCORE_PER_ROUND * (1 - dist / MAX_DIST_M));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- DRAW ALL NEIGHBOURHOOD POLYGONS (for All Geneva mode) ----
function drawAllNeighbourhoodPolygons(map, polygonsArray) {
  Object.values(ZONES).forEach(zone => {
    if (!zone.boundary) return;
    const poly = new google.maps.Polygon({
      paths: zone.boundary,
      map: map,
      strokeColor: '#b6f272',
      strokeOpacity: 0.6,
      strokeWeight: 1.5,
      fillColor: '#b6f272',
      fillOpacity: 0.06,
      clickable: false,
    });
    polygonsArray.push(poly);
  });
}

function clearPolygons(polygonsArray) {
  polygonsArray.forEach(p => p.setMap(null));
  polygonsArray.length = 0;
}

// ---- MAPS LOADING ----
function loadMapsAPI() {
  return new Promise((resolve) => {
    if (window.google && window.google.maps) { resolve(); return; }
    window.__mapsCallback = resolve;
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}&callback=__mapsCallback`;
    s.async = true;
    document.head.appendChild(s);
  });
}

// ---- FIND VALID STREET VIEW NEAR POINT ----
function findStreetView(latlng) {
  return new Promise((resolve, reject) => {
    const sv = new google.maps.StreetViewService();
    sv.getPanorama({
      location: latlng,
      radius: 200,
      source: google.maps.StreetViewSource.OUTDOOR,
    }, (data, status) => {
      if (status === google.maps.StreetViewStatus.OK) {
        resolve(data.location.latLng);
      } else {
        reject('No street view at this point');
      }
    });
  });
}

// ---- GAME FLOW ----
async function startGame() {
  if (!mapsReady) {
    await loadMapsAPI();
    mapsReady = true;
  }
  easyMode = document.getElementById('easy-mode-checkbox').checked;
  currentZone = document.getElementById('zone-select').value;
  round = 0;
  totalScore = 0;
  roundScores = [];
  const zone = ZONES[currentZone];
  roundLocations = shuffle(zone.points).slice(0, TOTAL_ROUNDS);
  showScreen('game-screen');
  await loadRound();
}

async function loadRound() {
  document.getElementById('sv-loader').style.display = 'flex';
  document.getElementById('hud-round-val').textContent = round + 1;
  document.getElementById('hud-score-val').textContent = totalScore;
  document.getElementById('hud-neighbourhood').textContent = ZONES[currentZone].name[lang];
  document.getElementById('next-btn').textContent = round === TOTAL_ROUNDS - 1 ? t('seeResults') : t('nextRound');
  guessLatLng = null;
  const guessBtn = document.getElementById('guess-btn');
  guessBtn.classList.remove('ready');
  guessBtn.textContent = t('placeGuess');

  const target = roundLocations[round];
  let svPos;
  try {
    svPos = await findStreetView(target);
  } catch {
    const fallback = ZONES[currentZone].points[(round + 3) % ZONES[currentZone].points.length];
    svPos = await findStreetView(fallback).catch(() => new google.maps.LatLng(target.lat, target.lng));
  }

  // Set up panorama
  if (!panorama) {
    panorama = new google.maps.StreetViewPanorama(
      document.getElementById('sv-container'),
      {
        position: svPos,
        addressControl: false,
        fullscreenControl: false,
        showRoadLabels: false,
        linksControl: true,
        enableCloseButton: false,
        motionTracking: false,
        motionTrackingControl: false,
      }
    );
  } else {
    panorama.setPosition(svPos);
    panorama.setPov({ heading: Math.random() * 360, pitch: 0 });
  }

  // Set up guess map
  const zone = ZONES[currentZone];
  if (!guessMap) {
    guessMap = new google.maps.Map(document.getElementById('map-container'), {
      center: zone.center,
      zoom: zone.zoom,
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: 'greedy',
      mapTypeId: 'hybrid',
    });
    guessMap.addListener('click', (e) => { placeGuessMarker(e.latLng); });
    document.getElementById('map-panel').addEventListener('mouseenter', () => {
      setTimeout(() => google.maps.event.trigger(guessMap, 'resize'), 50);
    });
  } else {
    guessMap.setCenter(zone.center);
    guessMap.setZoom(zone.zoom);
    if (guessMarker) { guessMarker.setMap(null); guessMarker = null; }
    if (hintCircle) { hintCircle.setMap(null); hintCircle = null; }
    if (neighbourhoodPolygon) { neighbourhoodPolygon.setMap(null); neighbourhoodPolygon = null; }
    clearPolygons(allNeighbourhoodPolygons);
  }

  // Draw boundaries on mini-map
  if (currentZone === 'geneva') {
    drawAllNeighbourhoodPolygons(guessMap, allNeighbourhoodPolygons);
  } else if (zone.boundary) {
    neighbourhoodPolygon = new google.maps.Polygon({
      paths: zone.boundary,
      map: guessMap,
      strokeColor: '#b6f272',
      strokeOpacity: 0.7,
      strokeWeight: 2,
      fillColor: '#b6f272',
      fillOpacity: 0.08,
      clickable: false,
    });
  }

  // Easy mode hint circle
  if (easyMode) {
    const offsetLat = (Math.random() - 0.5) * 0.004;
    const offsetLng = (Math.random() - 0.5) * 0.004;
    hintCircle = new google.maps.Circle({
      center: { lat: target.lat + offsetLat, lng: target.lng + offsetLng },
      radius: 400,
      map: guessMap,
      strokeColor: '#f2d672',
      strokeOpacity: 0.8,
      strokeWeight: 2,
      fillColor: '#f2d672',
      fillOpacity: 0.1,
      clickable: false,
    });
  }

  document.getElementById('sv-loader').style.display = 'none';
}

function placeGuessMarker(latLng) {
  if (guessMarker) guessMarker.setMap(null);
  guessMarker = new google.maps.Marker({
    position: latLng,
    map: guessMap,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 9,
      fillColor: '#b6f272',
      fillOpacity: 1,
      strokeColor: '#0d0f0e',
      strokeWeight: 2,
    }
  });
  guessLatLng = latLng;
  const btn = document.getElementById('guess-btn');
  btn.classList.add('ready');
  btn.textContent = t('placeGuess');
}

function toggleMap() {
  document.getElementById('map-panel').classList.toggle('expanded');
  google.maps.event.trigger(guessMap, 'resize');
}

async function submitGuess() {
  if (!guessLatLng) return;

  const target = roundLocations[round];
  const dist = haversineDistance(
    { lat: guessLatLng.lat(), lng: guessLatLng.lng() },
    target
  );
  const pts = scoreFromDistance(dist);
  totalScore += pts;
  roundScores.push({ dist, pts, round: round + 1 });

  showScreen('result-screen');

  // Fresh result map every round
  document.getElementById('result-map').innerHTML = '';
  resultMap = new google.maps.Map(document.getElementById('result-map'), {
    disableDefaultUI: true,
    gestureHandling: 'none',
    mapTypeId: 'hybrid',
  });

  const bounds = new google.maps.LatLngBounds();
  const tLatLng = new google.maps.LatLng(target.lat, target.lng);
  bounds.extend(tLatLng);
  bounds.extend(guessLatLng);
  resultMap.fitBounds(bounds, 60);

  // Draw all neighbourhood polygons on result map for All Geneva, else just the zone
  clearPolygons(resultPolygons);
  if (currentZone === 'geneva') {
    drawAllNeighbourhoodPolygons(resultMap, resultPolygons);
  } else {
    const zone = ZONES[currentZone];
    if (zone.boundary) {
      const poly = new google.maps.Polygon({
        paths: zone.boundary,
        map: resultMap,
        strokeColor: '#b6f272',
        strokeOpacity: 0.6,
        strokeWeight: 1.5,
        fillColor: '#b6f272',
        fillOpacity: 0.06,
        clickable: false,
      });
      resultPolygons.push(poly);
    }
  }

  // Actual location marker (red)
  new google.maps.Marker({
    position: tLatLng,
    map: resultMap,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 11,
      fillColor: '#f27272',
      fillOpacity: 1,
      strokeColor: '#fff',
      strokeWeight: 2,
    }
  });
  // Guess marker (green)
  new google.maps.Marker({
    position: guessLatLng,
    map: resultMap,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 9,
      fillColor: '#b6f272',
      fillOpacity: 1,
      strokeColor: '#0d0f0e',
      strokeWeight: 2,
    }
  });
  // Line between
  new google.maps.Polyline({
    path: [guessLatLng, tLatLng],
    map: resultMap,
    strokeColor: '#ffffff',
    strokeOpacity: 0.5,
    strokeWeight: 2,
  });

  document.getElementById('result-pts').textContent = '+' + pts;
  const distText = dist < 1000
    ? Math.round(dist) + ' ' + t('mAway')
    : (dist / 1000).toFixed(2) + ' ' + t('kmAway');
  document.getElementById('result-dist').textContent = distText;

  const isLast = round === TOTAL_ROUNDS - 1;
  document.getElementById('next-btn').textContent = isLast ? t('seeResults') : t('nextRound');
}

function nextRound() {
  round++;
  if (round >= TOTAL_ROUNDS) {
    showFinal();
  } else {
    showScreen('game-screen');
    resultMap = null;
    document.getElementById('result-map').innerHTML = '';
    loadRound();
  }
}

function showFinal() {
  document.getElementById('final-pts').textContent = totalScore;
  document.getElementById('final-title').textContent = t('finalScore');
  document.getElementById('final-max').textContent = t('outOf');
  document.getElementById('play-again-btn').textContent = t('playAgain');
  const summary = document.getElementById('round-summary');
  summary.innerHTML = '';
  roundScores.forEach(r => {
    const distText = r.dist < 1000
      ? Math.round(r.dist) + ' ' + t('mOff')
      : (r.dist / 1000).toFixed(1) + ' ' + t('kmOff');
    summary.innerHTML += `
      <div class="round-row">
        <span class="round-row-label">${t('round')} ${r.round}</span>
        <span style="color:var(--muted);font-size:0.8rem;font-family:'DM Mono',monospace">${distText}</span>
        <span class="round-row-pts">+${r.pts}</span>
      </div>`;
  });
  showScreen('final-screen');
}

function resetGame() {
  panorama = null;
  guessMap = null;
  resultMap = null;
  guessMarker = null;
  hintCircle = null;
  neighbourhoodPolygon = null;
  clearPolygons(allNeighbourhoodPolygons);
  clearPolygons(resultPolygons);
  document.getElementById('sv-container').innerHTML = `<div class="loader-overlay" id="sv-loader"><div class="loader-dot"></div><span id="sv-loader-text">${t('loading')}</span></div>`;
  document.getElementById('map-container').innerHTML = '';
  document.getElementById('result-map').innerHTML = '';
  showScreen('start-screen');
}

"use strict";

const INITIAL_CENTER = [43.0618, 141.3545];
const INITIAL_ZOOM = 13;
const LOCATION_ZOOM = 15;
const EARTH_RADIUS_METERS = 6371000;
const SAME_LOCATION_METERS = 10;
const SEARCH_LIMIT = 5;
const MAX_QUERY_LENGTH = 200;
const API_KEY_PLACEHOLDER = "YOUR_GEOAPIFY_API_KEY";

const state = {
  origin: null,
  destination: null,
  currentLocation: null,
  candidates: { origin: [], destination: [] },
  queries: { origin: "", destination: "" },
  travelMode: "walk",
  routeComparisonActive: false,
  route: null,
  straightDistanceMeters: null,
  loading: {
    originSearch: false,
    destinationSearch: false,
    geolocation: false,
    route: false
  },
  errors: {
    global: null,
    originSearch: null,
    destinationSearch: null,
    geolocation: null,
    route: null,
    tiles: null
  },
  requestIds: {
    originSearch: 0,
    destinationSearch: 0,
    route: 0,
    geolocation: 0
  }
};

const controllers = {
  originSearch: null,
  destinationSearch: null,
  route: null
};

const activeQueries = { origin: "", destination: "" };

const mapResources = {
  map: null,
  tileLayer: null,
  markers: [],
  routeLayer: null,
  tileErrorNotified: false
};

const elements = {};
let apiKey = "";
let resizeTimer = null;

document.addEventListener("DOMContentLoaded", initialize);

function initialize() {
  cacheElements();
  apiKey = readApiKey();
  bindEvents();
  initializeMap();
  renderAll();

  if (!apiKey) {
    setNotification(
      "warning",
      "APIキーが未設定です。config.example.jsを参考に、config.jsへ公開用の利用元制限付きキーを設定してください。"
    );
    showMapFallback("APIキーを設定するとGeoapifyの地図タイルを表示できます。地図操作UIは引き続き利用できます。");
  }
}

function cacheElements() {
  const ids = [
    "notification", "notification-icon", "notification-text",
    "origin-section", "origin-form", "origin-query", "origin-search", "origin-error",
    "origin-confirmed", "origin-candidates", "origin-candidate-status", "origin-candidate-list",
    "destination-section", "destination-form", "destination-query", "destination-search",
    "destination-error", "destination-confirmed", "destination-candidates", "destination-candidate-status",
    "destination-candidate-list", "use-current-location", "geolocation-status", "swap-points",
    "route-controls", "search-route", "route-action-reason", "route-error", "clear-route", "clear-all",
    "map", "map-fallback", "straight-distance", "straight-description", "route-distance",
    "route-duration", "route-mode"
  ];

  ids.forEach((id) => {
    elements[toCamelCase(id)] = document.getElementById(id);
  });
  elements.travelModes = Array.from(document.querySelectorAll('input[name="travel-mode"]'));
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function bindEvents() {
  elements.originForm.addEventListener("submit", (event) => {
    event.preventDefault();
    searchLocation("origin");
  });
  elements.destinationForm.addEventListener("submit", (event) => {
    event.preventDefault();
    searchLocation("destination");
  });
  elements.originQuery.addEventListener("input", () => updateQuery("origin"));
  elements.destinationQuery.addEventListener("input", () => updateQuery("destination"));
  elements.useCurrentLocation.addEventListener("click", requestCurrentLocation);
  elements.swapPoints.addEventListener("click", swapPoints);
  elements.searchRoute.addEventListener("click", () => searchRoute({ userInitiated: true }));
  elements.clearRoute.addEventListener("click", () => clearRoute({ notify: true }));
  elements.clearAll.addEventListener("click", clearAll);
  elements.travelModes.forEach((input) => input.addEventListener("change", changeTravelMode));
  window.addEventListener("resize", handleResize, { passive: true });
}

function readApiKey() {
  const value = window.APP_CONFIG && typeof window.APP_CONFIG.GEOAPIFY_API_KEY === "string"
    ? window.APP_CONFIG.GEOAPIFY_API_KEY.trim()
    : "";
  if (!value || value === API_KEY_PLACEHOLDER || /^YOUR_.+_API_KEY$/i.test(value)) {
    return "";
  }
  return value;
}

function initializeMap() {
  if (!window.L || typeof window.L.map !== "function") {
    state.errors.global = "Leaflet 1.9.4を読み込めないため、地図を初期化できませんでした。";
    showMapFallback(state.errors.global);
    setNotification("error", state.errors.global);
    return;
  }

  try {
    mapResources.map = window.L.map(elements.map, {
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      keyboard: true,
      attributionControl: true
    });
    mapResources.map.attributionControl.setPrefix(false);
    mapResources.map.attributionControl.addAttribution(
      'Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noopener">Geoapify</a> | <a href="https://openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>'
    );

    if (apiKey) {
      addTileLayer();
    }
  } catch (_error) {
    mapResources.map = null;
    state.errors.global = "地図を初期化できませんでした。ページを再読み込みしてください。";
    showMapFallback(state.errors.global);
    setNotification("error", state.errors.global);
  }
}

function addTileLayer() {
  if (!mapResources.map || !apiKey) {
    return;
  }
  const standardUrl = "https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}.png?apiKey={apiKey}";
  const retinaUrl = "https://maps.geoapify.com/v1/tile/osm-bright/{z}/{x}/{y}@2x.png?apiKey={apiKey}";
  const tileUrl = window.L.Browser.retina ? retinaUrl : standardUrl;

  mapResources.tileLayer = window.L.tileLayer(tileUrl, {
    apiKey,
    maxZoom: 20,
    attribution: ""
  });
  mapResources.tileLayer.on("tileerror", handleTileError);
  mapResources.tileLayer.on("load", () => {
    mapResources.tileErrorNotified = false;
    state.errors.tiles = null;
  });
  mapResources.tileLayer.addTo(mapResources.map);
}

function handleTileError() {
  if (mapResources.tileErrorNotified) {
    return;
  }
  mapResources.tileErrorNotified = true;
  state.errors.tiles = "地図タイルを読み込めませんでした。通信状態またはAPIキーの利用元制限を確認してください。";
  setNotification("error", state.errors.tiles);
}

function updateQuery(type) {
  state.queries[type] = getQueryElement(type).value;
  state.errors[`${type}Search`] = null;
  renderSearchError(type);
}

async function searchLocation(type) {
  const query = getQueryElement(type).value.trim();
  if (state.loading[`${type}Search`] && query === activeQueries[type]) {
    return;
  }
  state.queries[type] = getQueryElement(type).value;
  state.errors[`${type}Search`] = null;

  if (!query || query.length > MAX_QUERY_LENGTH) {
    state.errors[`${type}Search`] = query
      ? `検索語は${MAX_QUERY_LENGTH}文字以内で入力してください。`
      : "住所または施設名を入力してください。";
    renderSearchError(type);
    setNotification("error", `${typeLabel(type)}の検索条件を確認してください。`);
    return;
  }

  if (!apiKey) {
    state.errors[`${type}Search`] = "APIキーが未設定のため検索できません。config.jsを設定してください。";
    renderSearchError(type);
    setNotification("warning", state.errors[`${type}Search`]);
    return;
  }

  const biasSnapshot = getSearchBiasSnapshot(type);
  if (type === "origin") {
    invalidateGeolocationRequest();
    renderGeolocationStatus();
  }
  beginRequest(`${type}Search`);
  activeQueries[type] = query;
  state.candidates[type] = [];
  renderCandidates(type);
  renderControls();

  const requestId = state.requestIds[`${type}Search`];
  const controller = controllers[`${type}Search`];

  try {
    const url = new URL("https://api.geoapify.com/v1/geocode/search");
    const searchParams = new URLSearchParams({
      text: query,
      format: "geojson",
      lang: "ja",
      limit: String(SEARCH_LIMIT),
      apiKey
    });
    if (biasSnapshot) {
      searchParams.set("bias", `proximity:${biasSnapshot.longitude},${biasSnapshot.latitude}`);
    }
    url.search = searchParams.toString();

    const response = await fetch(url, { signal: controller.signal });
    if (!isLatestRequest(`${type}Search`, requestId)) {
      return;
    }
    if (!response.ok) {
      throw createHttpError(response.status, "地点検索");
    }

    const data = await parseJsonResponse(response, "地点検索");
    if (!isLatestRequest(`${type}Search`, requestId)) {
      return;
    }
    const candidates = parseGeocodingResponse(data);
    state.candidates[type] = candidates;

    if (candidates.length === 0) {
      state.errors[`${type}Search`] = "該当する候補がありません。住所や施設名を具体的にしてください。";
      setNotification("warning", `${typeLabel(type)}の検索結果は0件でした。`);
    } else {
      const message = candidates.length > 1
        ? `${typeLabel(type)}の候補が${candidates.length}件あります。住所を確認して選択してください。`
        : `${typeLabel(type)}の候補が1件あります。内容を確認して選択してください。`;
      setNotification("info", message);
    }
  } catch (error) {
    if (error && error.name === "AbortError") {
      return;
    }
    if (isLatestRequest(`${type}Search`, requestId)) {
      state.candidates[type] = [];
      state.errors[`${type}Search`] = safeErrorMessage(error, "地点検索中にネットワークエラーが発生しました。通信状態を確認して再試行してください。");
      setNotification("error", state.errors[`${type}Search`]);
    }
  } finally {
    if (isLatestRequest(`${type}Search`, requestId)) {
      state.loading[`${type}Search`] = false;
      activeQueries[type] = "";
      controllers[`${type}Search`] = null;
      renderSearch(type);
      renderControls();
    }
  }
}

function getSearchBiasSnapshot(type) {
  const oppositePoint = type === "destination" ? state.origin : state.destination;
  const candidates = [oppositePoint, state.currentLocation, getMapCenterSnapshot(), {
    latitude: INITIAL_CENTER[0],
    longitude: INITIAL_CENTER[1]
  }];
  const reference = candidates.find((point) => point
    && validCoordinates(Number(point.latitude), Number(point.longitude)));
  return reference ? {
    latitude: Number(reference.latitude),
    longitude: Number(reference.longitude)
  } : null;
}

function getMapCenterSnapshot() {
  if (!mapResources.map || typeof mapResources.map.getCenter !== "function") {
    return null;
  }
  try {
    const center = mapResources.map.getCenter();
    return center ? { latitude: Number(center.lat), longitude: Number(center.lng) } : null;
  } catch (_error) {
    return null;
  }
}

function parseGeocodingResponse(data) {
  if (!data || data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    throw new Error("地点検索サービスの応答形式が不正です。時間を置いて再試行してください。");
  }

  const parsed = [];
  data.features.slice(0, SEARCH_LIMIT).forEach((feature, index) => {
    if (!feature || feature.type !== "Feature" || !feature.properties) {
      return;
    }
    const properties = feature.properties;
    const coordinates = feature.geometry && Array.isArray(feature.geometry.coordinates)
      ? feature.geometry.coordinates
      : [];
    const latitude = toFiniteCoordinate(properties.lat, coordinates[1]);
    const longitude = toFiniteCoordinate(properties.lon, coordinates[0]);
    const label = typeof properties.formatted === "string" ? properties.formatted.trim() : "";

    if (!label || !validCoordinates(latitude, longitude)) {
      return;
    }

    const details = uniqueStrings([
      properties.result_type,
      properties.city,
      properties.state,
      properties.country
    ]).join(" / ");
    parsed.push({
      id: typeof properties.place_id === "string" && properties.place_id
        ? properties.place_id
        : `candidate-${index}-${latitude}-${longitude}`,
      label,
      supplementalLabel: details,
      latitude,
      longitude
    });
  });

  if (data.features.length > 0 && parsed.length === 0) {
    throw new Error("地点検索サービスの応答形式が不正です。候補の座標を確認できませんでした。");
  }
  return parsed;
}

function selectCandidate(type, candidate) {
  if (type === "origin") {
    invalidateGeolocationRequest();
  }
  invalidateRouteRequest();
  clearRouteState();
  state.routeComparisonActive = false;
  const point = {
    id: candidate.id,
    label: candidate.label,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    source: "search"
  };
  state[type] = point;
  state.queries[type] = point.label;
  getQueryElement(type).value = point.label;
  state.candidates[type] = [];
  state.errors[`${type}Search`] = null;
  recalculateStraightDistance();
  renderAll();
  updateMarkers();
  focusSelectedPoints(point);
  setNotification("success", `${typeLabel(type)}を設定しました。`);
}

function requestCurrentLocation() {
  if (state.loading.geolocation) {
    return;
  }
  if (!navigator.geolocation) {
    state.errors.geolocation = "このブラウザでは位置情報を利用できません。検索から出発地Aを設定してください。";
    renderGeolocationStatus();
    setNotification("error", state.errors.geolocation);
    return;
  }

  cancelOriginSearch();
  const requestId = ++state.requestIds.geolocation;
  state.loading.geolocation = true;
  state.errors.geolocation = null;
  renderSearch("origin");
  renderControls();
  renderGeolocationStatus();

  navigator.geolocation.getCurrentPosition(
    (position) => handleGeolocationSuccess(position, requestId),
    (error) => handleGeolocationError(error, requestId),
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }
  );
}

function handleGeolocationSuccess(position, requestId) {
  if (requestId !== state.requestIds.geolocation) {
    return;
  }
  state.loading.geolocation = false;
  const latitude = position && position.coords ? Number(position.coords.latitude) : NaN;
  const longitude = position && position.coords ? Number(position.coords.longitude) : NaN;

  if (!validCoordinates(latitude, longitude)) {
    state.errors.geolocation = "現在地の座標を確認できませんでした。検索から出発地Aを設定してください。";
    renderAll();
    setNotification("error", state.errors.geolocation);
    return;
  }

  invalidateRouteRequest();
  clearRouteState();
  state.routeComparisonActive = false;
  state.currentLocation = {
    id: `current-${requestId}`,
    label: "現在地",
    latitude,
    longitude,
    source: "geolocation"
  };
  state.origin = {
    id: `origin-current-${requestId}`,
    label: "現在地",
    latitude,
    longitude,
    source: "geolocation"
  };
  state.queries.origin = "現在地";
  elements.originQuery.value = "現在地";
  state.candidates.origin = [];
  recalculateStraightDistance();
  renderAll();
  updateMarkers();
  focusSelectedPoints(state.origin);
  setNotification("success", "現在地を出発地Aに設定しました。");
}

function handleGeolocationError(error, requestId) {
  if (requestId !== state.requestIds.geolocation) {
    return;
  }
  state.loading.geolocation = false;
  const code = error && Number(error.code);
  if (code === 1) {
    state.errors.geolocation = "位置情報の利用が拒否されました。ブラウザ設定を確認するか、検索から出発地Aを設定してください。";
  } else if (code === 3) {
    state.errors.geolocation = "10秒以内に現在地を取得できませんでした。再試行するか、検索から出発地Aを設定してください。";
  } else {
    state.errors.geolocation = "現在地を取得できませんでした。再試行するか、検索から出発地Aを設定してください。";
  }
  renderAll();
  setNotification("error", state.errors.geolocation);
}

function changeTravelMode(event) {
  if (!event.target.checked) {
    return;
  }
  const nextMode = event.target.value === "drive" ? "drive" : "walk";
  if (nextMode === state.travelMode) {
    return;
  }
  const shouldAutoSearch = state.routeComparisonActive
    && Boolean(state.origin && state.destination && apiKey)
    && haversineDistance(state.origin, state.destination) > SAME_LOCATION_METERS;
  state.travelMode = nextMode;
  clearRouteForModeChange();
  renderAll();
  if (shouldAutoSearch) {
    searchRoute({ automatic: true, updateReason: "mode" });
  }
}

function clearRouteForModeChange() {
  invalidateRouteRequest();
  clearRouteState();
}

function swapPoints() {
  if (!state.origin || !state.destination) {
    return;
  }
  const shouldAutoSearch = state.routeComparisonActive
    && Boolean(apiKey)
    && haversineDistance(state.origin, state.destination) > SAME_LOCATION_METERS;
  invalidateAllNetworkRequests();
  const previousOrigin = state.origin;
  state.origin = state.destination;
  state.destination = previousOrigin;
  state.queries.origin = state.origin.label;
  state.queries.destination = state.destination.label;
  elements.originQuery.value = state.origin.label;
  elements.destinationQuery.value = state.destination.label;
  state.candidates.origin = [];
  state.candidates.destination = [];
  state.errors.originSearch = null;
  state.errors.destinationSearch = null;
  clearRouteState();
  recalculateStraightDistance();
  renderAll();
  updateMarkers();
  focusSelectedPoints();
  if (shouldAutoSearch) {
    searchRoute({ automatic: true, updateReason: "swap" });
  } else {
    setNotification("info", "出発地Aと目的地Bを入れ替えました。ルートは再検索してください。");
  }
}

async function searchRoute(options = {}) {
  const userInitiated = options.userInitiated === true;
  const automatic = options.automatic === true;
  const disabledReason = getRouteDisabledReason();
  if (disabledReason) {
    renderControls();
    return;
  }

  if (userInitiated) {
    state.routeComparisonActive = true;
  }

  if (haversineDistance(state.origin, state.destination) <= SAME_LOCATION_METERS) {
    state.errors.route = "出発地Aと目的地Bが実質的に同一です。10mより離れた地点を設定してください。";
    renderRouteError();
    setNotification("error", state.errors.route);
    return;
  }

  invalidateRouteRequest();
  clearRouteState();
  const requestId = state.requestIds.route;
  const controller = new AbortController();
  controllers.route = controller;
  state.loading.route = true;
  state.errors.route = null;
  const originSnapshot = coordinateSnapshot(state.origin);
  const destinationSnapshot = coordinateSnapshot(state.destination);
  const modeSnapshot = state.travelMode;
  const loadingMessage = automatic && options.updateReason === "swap"
    ? "入れ替え後のルートを更新しています…"
    : automatic
      ? `${travelModeLabel(modeSnapshot)}のルートを更新しています…`
      : `${travelModeLabel(modeSnapshot)}のルートを検索中です…`;
  setNotification("info", loadingMessage);
  renderAll();

  try {
    const url = new URL("https://api.geoapify.com/v1/routing");
    url.search = new URLSearchParams({
      waypoints: `${originSnapshot.latitude},${originSnapshot.longitude}|${destinationSnapshot.latitude},${destinationSnapshot.longitude}`,
      mode: modeSnapshot,
      format: "geojson",
      apiKey
    }).toString();

    const response = await fetch(url, { signal: controller.signal });
    if (!routeRequestStillCurrent(requestId, originSnapshot, destinationSnapshot, modeSnapshot)) {
      return;
    }
    if (!response.ok) {
      throw createHttpError(response.status, "ルート検索");
    }
    const data = await parseJsonResponse(response, "ルート検索");
    if (!routeRequestStillCurrent(requestId, originSnapshot, destinationSnapshot, modeSnapshot)) {
      return;
    }
    const route = parseRoutingResponse(data, originSnapshot, destinationSnapshot, modeSnapshot);
    state.route = route;
    drawRoute(route.geometry);
    fitRouteBounds();
    setNotification("success", `${travelModeLabel(modeSnapshot)}のルートを表示しました。`);
  } catch (error) {
    if (error && error.name === "AbortError") {
      return;
    }
    if (routeRequestStillCurrent(requestId, originSnapshot, destinationSnapshot, modeSnapshot)) {
      state.errors.route = safeErrorMessage(error, "ルート検索中にネットワークエラーが発生しました。通信状態を確認して再試行してください。");
      state.route = null;
      removeRouteLayer();
      setNotification("error", state.errors.route);
    }
  } finally {
    if (requestId === state.requestIds.route) {
      state.loading.route = false;
      controllers.route = null;
      renderAll();
    }
  }
}

function parseRoutingResponse(data, origin, destination, mode) {
  if (!data || data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    throw new Error("ルート検索サービスの応答形式が不正です。時間を置いて再試行してください。");
  }
  if (data.features.length === 0) {
    throw new Error("指定した地点と移動手段ではルートが見つかりません。地点または移動手段を変更してください。");
  }

  const feature = data.features.find((item) => {
    const properties = item && item.properties;
    return item && item.type === "Feature" && isValidRouteGeometry(item.geometry)
      && properties && isNonNegativeFinite(properties.distance) && isNonNegativeFinite(properties.time);
  });
  if (!feature) {
    throw new Error("ルート検索サービスの応答形式が不正です。経路情報を確認できませんでした。");
  }

  return {
    mode,
    geometry: feature.geometry,
    distanceMeters: Number(feature.properties.distance),
    durationSeconds: Number(feature.properties.time),
    origin,
    destination
  };
}

function isValidRouteGeometry(geometry) {
  if (!geometry || !["LineString", "MultiLineString"].includes(geometry.type) || !Array.isArray(geometry.coordinates)) {
    return false;
  }
  const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
  return lines.length > 0 && lines.every((line) => Array.isArray(line) && line.length >= 2
    && line.every((pair) => Array.isArray(pair) && pair.length >= 2
      && validCoordinates(Number(pair[1]), Number(pair[0]))));
}

function clearRoute(options = {}) {
  invalidateRouteRequest();
  clearRouteState();
  state.routeComparisonActive = false;
  renderAll();
  if (options.notify) {
    setNotification("info", "経路をクリアしました。地点と直線距離は維持されています。");
  }
}

function clearRouteState() {
  state.route = null;
  state.errors.route = null;
  state.loading.route = false;
  removeRouteLayer();
}

function clearAll() {
  invalidateAllNetworkRequests();
  state.origin = null;
  state.destination = null;
  state.currentLocation = null;
  state.candidates.origin = [];
  state.candidates.destination = [];
  state.queries.origin = "";
  state.queries.destination = "";
  state.travelMode = "walk";
  state.routeComparisonActive = false;
  state.route = null;
  state.straightDistanceMeters = null;
  Object.keys(state.errors).forEach((key) => {
    state.errors[key] = null;
  });
  elements.originQuery.value = "";
  elements.destinationQuery.value = "";
  elements.travelModes.forEach((input) => {
    input.checked = input.value === "walk";
  });
  removeRouteLayer();
  removeMarkers();
  if (mapResources.map) {
    mapResources.map.setView(INITIAL_CENTER, INITIAL_ZOOM);
  }
  renderAll();
  if (!apiKey) {
    setNotification("warning", "地点をクリアしました。APIキーを設定すると検索と地図タイルを利用できます。");
  } else {
    setNotification("info", "地点と経路をすべてクリアしました。");
  }
}

function invalidateAllNetworkRequests() {
  ["originSearch", "destinationSearch", "route"].forEach((key) => {
    if (controllers[key]) {
      controllers[key].abort();
      controllers[key] = null;
    }
    state.requestIds[key] += 1;
    state.loading[key] = false;
  });
  state.requestIds.geolocation += 1;
  state.loading.geolocation = false;
  activeQueries.origin = "";
  activeQueries.destination = "";
}

function invalidateRouteRequest() {
  if (controllers.route) {
    controllers.route.abort();
    controllers.route = null;
  }
  state.requestIds.route += 1;
  state.loading.route = false;
}

function cancelOriginSearch() {
  if (controllers.originSearch) {
    controllers.originSearch.abort();
    controllers.originSearch = null;
  }
  state.requestIds.originSearch += 1;
  state.loading.originSearch = false;
  activeQueries.origin = "";
  state.candidates.origin = [];
  state.errors.originSearch = null;
}

function invalidateGeolocationRequest() {
  state.requestIds.geolocation += 1;
  state.loading.geolocation = false;
  state.errors.geolocation = null;
}

function beginRequest(key) {
  if (controllers[key]) {
    controllers[key].abort();
  }
  state.requestIds[key] += 1;
  state.loading[key] = true;
  controllers[key] = new AbortController();
}

function isLatestRequest(key, requestId) {
  return requestId === state.requestIds[key];
}

function routeRequestStillCurrent(requestId, origin, destination, mode) {
  return requestId === state.requestIds.route
    && sameCoordinates(state.origin, origin)
    && sameCoordinates(state.destination, destination)
    && state.travelMode === mode;
}

function coordinateSnapshot(point) {
  return { latitude: point.latitude, longitude: point.longitude };
}

function createHttpError(status, operation) {
  let guidance = "通信状態を確認して再試行してください。";
  if (status === 401 || status === 403) {
    guidance = "APIキーの設定とGeoapifyの利用元制限を確認してください。";
  } else if (status === 429) {
    guidance = "利用上限に達した可能性があります。時間を置いて再試行してください。";
  }
  return new Error(`${operation}サービスからエラーが返されました（HTTP ${status}）。${guidance}`);
}

async function parseJsonResponse(response, operation) {
  try {
    return await response.json();
  } catch (_error) {
    throw new Error(`${operation}サービスの応答形式が不正です。時間を置いて再試行してください。`);
  }
}

function safeErrorMessage(error, fallback) {
  if (error instanceof Error && typeof error.message === "string" && error.message) {
    return error.message;
  }
  return fallback;
}

function recalculateStraightDistance() {
  state.straightDistanceMeters = state.currentLocation && state.destination
    ? haversineDistance(state.currentLocation, state.destination)
    : null;
}

function haversineDistance(first, second) {
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const firstLatitude = toRadians(first.latitude);
  const secondLatitude = toRadians(second.latitude);
  const latitudeDelta = secondLatitude - firstLatitude;
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const rawA = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  const a = Math.min(1, Math.max(0, rawA));
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

function formatDistance(meters) {
  if (meters < 10) {
    return "10 m未満";
  }
  if (meters < 1000) {
    return `${Math.round(meters / 10) * 10} m`;
  }
  return `${(Math.round(meters / 100) / 10).toFixed(1)} km`;
}

function formatDuration(seconds) {
  if (seconds < 60) {
    return "1分未満";
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}分`;
  }
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining === 0 ? `${hours}時間` : `${hours}時間${remaining}分`;
}

function renderAll() {
  renderSearch("origin");
  renderSearch("destination");
  renderGeolocationStatus();
  renderControls();
  renderResults();
}

function renderSearch(type) {
  const loading = state.loading[`${type}Search`];
  const sectionBusy = type === "origin" ? loading || state.loading.geolocation : loading;
  getSectionElement(type).setAttribute("aria-busy", String(sectionBusy));
  getSearchButton(type).textContent = loading ? "検索中…" : "検索";
  getConfirmedElement(type).textContent = state[type] ? state[type].label : "未設定";
  renderSearchError(type);
  renderCandidates(type);
}

function renderSearchError(type) {
  const errorElement = getErrorElement(type);
  const error = state.errors[`${type}Search`];
  errorElement.textContent = error || "";
  errorElement.hidden = !error;
  getQueryElement(type).setAttribute("aria-invalid", String(Boolean(error)));
}

function renderCandidates(type) {
  const area = getCandidateArea(type);
  const status = getCandidateStatus(type);
  const list = getCandidateList(type);
  list.replaceChildren();
  const candidates = state.candidates[type];

  if (candidates.length === 0) {
    area.hidden = true;
    status.textContent = "";
    return;
  }

  status.textContent = candidates.length > 1
    ? `候補${candidates.length}件。住所を確認して選択してください。`
    : "候補1件。内容を確認して選択してください。";
  candidates.forEach((candidate, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const label = document.createElement("strong");
    const supplemental = document.createElement("span");
    button.type = "button";
    button.className = "candidate-button";
    button.setAttribute("aria-label", `${typeLabel(type)}候補${index + 1}：${candidate.label}${candidate.supplementalLabel ? `、${candidate.supplementalLabel}` : ""}`);
    label.textContent = candidate.label;
    supplemental.textContent = candidate.supplementalLabel || "補足情報なし";
    button.append(label, supplemental);
    button.addEventListener("click", () => selectCandidate(type, candidate));
    item.append(button);
    list.append(item);
  });
  area.hidden = false;
}

function renderGeolocationStatus() {
  elements.geolocationStatus.textContent = state.loading.geolocation
    ? "現在地を取得中です…"
    : state.errors.geolocation || "";
  elements.geolocationStatus.classList.toggle("field-error", Boolean(state.errors.geolocation));
}

function renderControls() {
  elements.originSearch.disabled = !apiKey || state.loading.originSearch;
  elements.destinationSearch.disabled = !apiKey || state.loading.destinationSearch;
  elements.useCurrentLocation.disabled = state.loading.geolocation;
  elements.useCurrentLocation.textContent = state.loading.geolocation
    ? "現在地を取得中…"
    : "◎ 現在地を出発地に設定";
  elements.swapPoints.disabled = !state.origin || !state.destination;
  const routeActionMessage = getRouteActionMessage();
  elements.searchRoute.disabled = Boolean(routeActionMessage);
  elements.searchRoute.textContent = state.loading.route ? "ルートを検索中…" : "ルートを検索";
  elements.routeActionReason.textContent = routeActionMessage;
  elements.routeActionReason.hidden = !routeActionMessage;
  if (routeActionMessage) {
    elements.searchRoute.setAttribute("aria-describedby", "route-action-reason");
  } else {
    elements.searchRoute.removeAttribute("aria-describedby");
  }
  elements.routeControls.setAttribute("aria-busy", String(state.loading.route));
  elements.clearRoute.disabled = !state.route && !state.loading.route && !state.errors.route;
  renderRouteError();
}

function getRouteDisabledReason() {
  if (!state.origin && !state.destination) {
    return "出発地Aと目的地Bを設定してください。";
  }
  if (!state.origin) {
    return "出発地Aを設定してください。";
  }
  if (!state.destination) {
    return "目的地Bを設定してください。";
  }
  if (!apiKey) {
    return "APIキーが未設定のためルートを検索できません。";
  }
  if (state.loading.route) {
    return "ルートを検索中です。";
  }
  if (haversineDistance(state.origin, state.destination) <= SAME_LOCATION_METERS) {
    return "2地点が10m以内の場合はルートを検索できません。";
  }
  return "";
}

function getRouteActionMessage() {
  return getRouteDisabledReason();
}

function renderRouteError() {
  elements.routeError.textContent = state.errors.route || "";
  elements.routeError.hidden = !state.errors.route;
}

function renderResults() {
  if (Number.isFinite(state.straightDistanceMeters)) {
    elements.straightDistance.textContent = `約 ${formatDistance(state.straightDistanceMeters)}`;
    elements.straightDescription.textContent = "緯度経度からJavaScriptで計算した、現在地から目的地Bまでの直線距離の概算です。";
  } else {
    elements.straightDistance.textContent = "未計算";
    elements.straightDescription.textContent = !state.currentLocation
      ? "現在地を取得すると、目的地Bまでの直線距離を計算できます。"
      : "目的地Bを設定すると、現在地からの直線距離を計算できます。";
  }

  elements.routeDistance.textContent = state.route ? formatDistance(state.route.distanceMeters) : "未計算";
  elements.routeDuration.textContent = state.route ? formatDuration(state.route.durationSeconds) : "未計算";
  elements.routeMode.textContent = travelModeLabel(state.travelMode);
}

function updateMarkers() {
  if (!mapResources.map || !window.L) {
    return;
  }
  removeMarkers();

  if (isCombinedCurrentOrigin()) {
    addMarker(state.origin, "combined", "A・現在地");
  } else {
    if (state.origin) {
      addMarker(state.origin, "origin", "出発地A");
    }
    if (state.currentLocation) {
      addMarker(state.currentLocation, "current", "現在地");
    }
  }
  if (state.destination) {
    addMarker(state.destination, "destination", "目的地B");
  }
}

function isCombinedCurrentOrigin() {
  return Boolean(state.origin && state.currentLocation
    && state.origin.source === "geolocation"
    && sameCoordinates(state.origin, state.currentLocation));
}

function addMarker(point, kind, accessibleName) {
  const markerText = kind === "origin" ? "A"
    : kind === "destination" ? "B"
      : kind === "combined" ? "A・現在地" : "◎";
  const className = `map-marker map-marker-${kind}`;
  const iconWidth = kind === "combined" ? 82 : 42;
  const icon = window.L.divIcon({
    className: "map-marker-host",
    html: `<div class="${className}"><span>${markerText}</span></div>`,
    iconSize: [iconWidth, 42],
    iconAnchor: [iconWidth / 2, 38]
  });
  const marker = window.L.marker([point.latitude, point.longitude], {
    icon,
    keyboard: true,
    title: accessibleName,
    alt: accessibleName
  }).addTo(mapResources.map);
  mapResources.markers.push(marker);
}

function removeMarkers() {
  if (mapResources.map) {
    mapResources.markers.forEach((marker) => mapResources.map.removeLayer(marker));
  }
  mapResources.markers = [];
}

function drawRoute(geometry) {
  removeRouteLayer();
  if (!mapResources.map || !window.L) {
    return;
  }
  mapResources.routeLayer = window.L.geoJSON({ type: "Feature", properties: {}, geometry }, {
    style: { color: "#176d75", weight: 6, opacity: 0.9 }
  }).addTo(mapResources.map);
}

function removeRouteLayer() {
  if (mapResources.map && mapResources.routeLayer) {
    mapResources.map.removeLayer(mapResources.routeLayer);
  }
  mapResources.routeLayer = null;
}

function focusSelectedPoints(fallbackPoint) {
  if (!mapResources.map) {
    return;
  }
  if (state.origin && state.destination && !sameCoordinates(state.origin, state.destination)) {
    mapResources.map.fitBounds([
      [state.origin.latitude, state.origin.longitude],
      [state.destination.latitude, state.destination.longitude]
    ], { padding: [38, 38] });
  } else if (fallbackPoint) {
    mapResources.map.setView([fallbackPoint.latitude, fallbackPoint.longitude], LOCATION_ZOOM);
  }
}

function fitRouteBounds() {
  if (!mapResources.map || !mapResources.routeLayer) {
    return;
  }
  const bounds = mapResources.routeLayer.getBounds();
  if (bounds.isValid()) {
    mapResources.map.fitBounds(bounds, { padding: [42, 42] });
  } else if (state.origin) {
    mapResources.map.setView([state.origin.latitude, state.origin.longitude], LOCATION_ZOOM);
  }
}

function showMapFallback(message) {
  elements.mapFallback.textContent = message;
  elements.mapFallback.hidden = false;
}

function handleResize() {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (mapResources.map) {
      mapResources.map.invalidateSize();
      if (state.route) {
        fitRouteBounds();
      } else {
        focusSelectedPoints(state.origin || state.destination || state.currentLocation);
      }
    }
  }, 150);
}

function setNotification(type, message) {
  const safeType = ["info", "success", "warning", "error"].includes(type) ? type : "info";
  elements.notification.className = `notification notification-${safeType}`;
  elements.notificationIcon.textContent = safeType === "success" ? "✓" : safeType === "warning" ? "!" : safeType === "error" ? "×" : "i";
  elements.notificationText.textContent = message;
  elements.notification.setAttribute("role", safeType === "error" ? "alert" : "status");
}

function validCoordinates(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

function toFiniteCoordinate(primary, fallback) {
  if (primary !== null && primary !== undefined && primary !== "") {
    const primaryNumber = Number(primary);
    if (Number.isFinite(primaryNumber)) {
      return primaryNumber;
    }
  }
  return Number(fallback);
}

function isNonNegativeFinite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
}

function sameCoordinates(first, second) {
  return Boolean(first && second
    && first.latitude === second.latitude
    && first.longitude === second.longitude);
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim())));
}

function travelModeLabel(mode) {
  return mode === "drive" ? "車" : "徒歩";
}

function typeLabel(type) {
  return type === "origin" ? "出発地A" : "目的地B";
}

function getQueryElement(type) {
  return type === "origin" ? elements.originQuery : elements.destinationQuery;
}

function getSearchButton(type) {
  return type === "origin" ? elements.originSearch : elements.destinationSearch;
}

function getSectionElement(type) {
  return type === "origin" ? elements.originSection : elements.destinationSection;
}

function getErrorElement(type) {
  return type === "origin" ? elements.originError : elements.destinationError;
}

function getConfirmedElement(type) {
  return type === "origin" ? elements.originConfirmed : elements.destinationConfirmed;
}

function getCandidateArea(type) {
  return type === "origin" ? elements.originCandidates : elements.destinationCandidates;
}

function getCandidateStatus(type) {
  return type === "origin" ? elements.originCandidateStatus : elements.destinationCandidateStatus;
}

function getCandidateList(type) {
  return type === "origin" ? elements.originCandidateList : elements.destinationCandidateList;
}

// Configurações
const OSRM_BASE_URL = 'https://router.project-osrm.org/route/v1';
const ELEVATION_API_URL = 'https://api.open-elevation.com/api/v1/lookup';

// Variáveis globais
let map, startMarker, endMarker, routeLayer;
let currentMode = 'walking';
let currentRoute = null;

document.addEventListener('DOMContentLoaded', function() {
    initMap();
    setupEventListeners();
});

function initMap() {
    // Inicializa o mapa centrado no Brasil
    map = L.map('map').setView([-15.788, -47.879], 5);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
    
    // Adiciona controle de busca
    L.Control.geocoder({
        defaultMarkGeocode: false,
        position: 'topleft'
    }).on('markgeocode', function(e) {
        const center = e.geocode.center;
        if (!startMarker) {
            setStartLocation(center.lat, center.lng, e.geocode.name);
        } else if (!endMarker) {
            setEndLocation(center.lat, center.lng, e.geocode.name);
        }
        map.fitBounds(e.geocode.bbox);
    }).addTo(map);
}

function setupEventListeners() {
    // Seleção de modo de transporte
    document.querySelectorAll('.mode-btn').forEach(button => {
        button.addEventListener('click', function() {
            document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            currentMode = this.dataset.mode;
            if (currentRoute) calculateRoute();
        });
    });
    
    // Botão de encontrar rota
    document.getElementById('find-route').addEventListener('click', function() {
        const origin = document.getElementById('origin').value;
        const destination = document.getElementById('destination').value;
        
        if (!origin || !destination) {
            alert('Por favor, preencha origem e destino');
            return;
        }
        
        // Geocode ambos os endereços
        geocodeAddress(origin, 'start');
        geocodeAddress(destination, 'end');
    });
    
    // Calculadora de carbono
    document.getElementById('calculate').addEventListener('click', calculateEmissions);
}

async function geocodeAddress(address, type) {
    try {
        const response = await axios.get('https://nominatim.openstreetmap.org/search', {
            params: {
                q: address,
                format: 'json',
                limit: 1
            }
        });
        
        if (response.data && response.data.length > 0) {
            const result = response.data[0];
            const lat = parseFloat(result.lat);
            const lon = parseFloat(result.lon);
            
            if (type === 'start') {
                setStartLocation(lat, lon, result.display_name);
                document.getElementById('origin').value = result.display_name;
            } else {
                setEndLocation(lat, lon, result.display_name);
                document.getElementById('destination').value = result.display_name;
            }
            
            // Se ambos os pontos estão definidos, calcular rota
            if (startMarker && endMarker) {
                calculateRoute();
            }
        } else {
            alert(`Não foi possível encontrar o endereço: ${address}`);
        }
    } catch (error) {
        console.error('Erro no geocoding:', error);
        alert('Erro ao buscar localização. Tente novamente.');
    }
}

function setStartLocation(lat, lng, name) {
    if (startMarker) map.removeLayer(startMarker);
    startMarker = L.marker([lat, lng], {icon: greenIcon}).addTo(map)
        .bindPopup(`<b>Origem:</b> ${name}`)
        .openPopup();
}

function setEndLocation(lat, lng, name) {
    if (endMarker) map.removeLayer(endMarker);
    endMarker = L.marker([lat, lng], {icon: redIcon}).addTo(map)
        .bindPopup(`<b>Destino:</b> ${name}`);
}

// Ícones personalizados
const greenIcon = L.icon({
    iconUrl: 'https://cdn.rawgit.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

const redIcon = L.icon({
    iconUrl: 'https://cdn.rawgit.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

async function calculateRoute() {
    if (!startMarker || !endMarker) return;
    
    const start = startMarker.getLatLng();
    const end = endMarker.getLatLng();
    
    try {
        // Limpa rota anterior
        if (routeLayer) map.removeLayer(routeLayer);
        
        // Mostra loading
        document.getElementById('route-info').innerHTML = '<h3>Calculando rota...</h3>';
        
        // Obtém o perfil de rota baseado no modo selecionado
        const profile = getRoutingProfile();
        
        // Faz requisição à API OSRM
        const response = await axios.get(`${OSRM_BASE_URL}/${profile}/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`);
        
        if (response.data && response.data.routes && response.data.routes.length > 0) {
            currentRoute = response.data.routes[0];
            displayRoute(currentRoute);
            
            // Obtém dados de elevação para a rota
            await getElevationData(currentRoute.geometry.coordinates);
        } else {
            throw new Error('Nenhuma rota encontrada');
        }
    } catch (error) {
        console.error('Erro no cálculo da rota:', error);
        document.getElementById('route-info').innerHTML = '<h3>Erro ao calcular rota</h3><p>Tente ajustar os pontos de partida e destino</p>';
    }
}

function getRoutingProfile() {
    switch(currentMode) {
        case 'walking': return 'foot';
        case 'bicycling': return 'bike';
        case 'driving': return 'car';
        default: return 'car';
    }
}

function displayRoute(route) {
    // Converte coordenadas para formato [lat, lng]
    const coordinates = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);
    
    // Cria a linha da rota no mapa
    routeLayer = L.polyline(coordinates, {
        color: getRouteColor(currentMode),
        weight: 6,
        opacity: 0.8,
        smoothFactor: 1
    }).addTo(map);
    
    // Ajusta o zoom para mostrar toda a rota
    map.fitBounds(routeLayer.getBounds(), {padding: [50, 50]});
    
    // Atualiza informações da rota
    updateRouteInfo(route);
}

function getRouteColor(mode) {
    switch(mode) {
        case 'walking': return '#2ecc71'; // Verde
        case 'bicycling': return '#3498db'; // Azul
        case 'driving': return '#e74c3c'; // Vermelho
        default: return '#666';
    }
}

function updateRouteInfo(route) {
    const distance = (route.distance / 1000).toFixed(1); // km
    const duration = formatDuration(route.duration); // horas/min
    
    // Calcula emissões aproximadas
    let emissions, benefits;
    switch(currentMode) {
        case 'walking':
            emissions = 0;
            benefits = 'Zero emissões! Você está ajudando a preservar o meio ambiente.';
            break;
        case 'bicycling':
            emissions = 0;
            benefits = 'Zero emissões diretas! Além de ecológico, é ótimo para sua saúde.';
            break;
        case 'driving':
            emissions = (distance * 0.12).toFixed(1); // ~120g CO2/km
            benefits = 'Considere alternativas como transporte público ou carona solidária.';
            break;
    }
    
    document.getElementById('route-info').innerHTML = `
        <h3>Sua Rota Ecológica</h3>
        <p><strong>Modo:</strong> ${getModeName(currentMode)}</p>
        <p><strong>Distância:</strong> ${distance} km</p>
        <p><strong>Duração estimada:</strong> ${duration}</p>
        <p><strong>Emissões de CO₂:</strong> ${emissions} kg</p>
        <p><strong>Benefícios:</strong> ${benefits}</p>
    `;
}

function getModeName(mode) {
    switch(mode) {
        case 'walking': return 'Caminhada';
        case 'bicycling': return 'Bicicleta';
        case 'driving': return 'Carro';
        default: return '';
    }
}

function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes}min`;
    } else {
        return `${minutes} min`;
    }
}

async function getElevationData(coordinates) {
    try {
        // Prepara os pontos para a API de elevação (limitado a 100 pontos para demo)
        const sampledCoordinates = sampleCoordinates(coordinates, 100);
        const locations = sampledCoordinates.map(coord => ({
            latitude: coord[1],
            longitude: coord[0]
        }));
        
        const response = await axios.post(ELEVATION_API_URL, {
            locations: locations
        });
        
        if (response.data && response.data.results) {
            analyzeElevation(response.data.results);
        }
    } catch (error) {
        console.error('Erro ao obter elevação:', error);
        // Não é crítico para a aplicação, podemos continuar sem esses dados
    }
}

function sampleCoordinates(coords, maxPoints) {
    if (coords.length <= maxPoints) return coords;
    
    const step = Math.floor(coords.length / maxPoints);
    const sampled = [];
    
    for (let i = 0; i < coords.length; i += step) {
        sampled.push(coords[i]);
        if (sampled.length >= maxPoints) break;
    }
    
    return sampled;
}

function analyzeElevation(elevationPoints) {
    if (!elevationPoints || elevationPoints.length < 2) return;
    
    let totalClimb = 0;
    let totalDescent = 0;
    
    for (let i = 1; i < elevationPoints.length; i++) {
        const diff = elevationPoints[i].elevation - elevationPoints[i-1].elevation;
        if (diff > 0) totalClimb += diff;
        else totalDescent += Math.abs(diff);
    }
    
    // Atualiza informações da rota com dados de elevação
    const routeInfo = document.getElementById('route-info');
    const elevationInfo = document.createElement('p');
    elevationInfo.innerHTML = `<strong>Dificuldade:</strong> Elevação total +${totalClimb.toFixed(0)}m / -${totalDescent.toFixed(0)}m`;
    routeInfo.appendChild(elevationInfo);
    
    // Adiciona dica baseada na elevação
    if (currentMode === 'bicycling' && totalClimb > 200) {
        const tip = document.createElement('p');
        tip.innerHTML = '<strong>Dica:</strong> Esta rota tem subidas significativas. Considere uma bicicleta com marchas adequadas.';
        tip.style.color = '#e67e22';
        routeInfo.appendChild(tip);
    }
}

function calculateEmissions() {
    const distance = parseFloat(document.getElementById('calc-distance').value);
    const mode = document.getElementById('calc-mode').value;
    
    if (isNaN(distance)) {
        alert('Por favor, insira uma distância válida');
        return;
    }

    
    let emissions, message;
    const co2PerKm = {
        'car': 0.12,
        'car-diesel': 0.15,
        'car-electric': 0.05,
        'bus': 0.07,
        'bike': 0,
        'walking': 0
    };
    
    emissions = distance * co2PerKm[mode];
    
    switch(mode) {
        case 'car':
            message = `Dirigindo ${distance} km em um carro a gasolina emite aproximadamente ${emissions.toFixed(1)} kg de CO₂.`;
            break;
        case 'car-diesel':
            message = `Dirigindo ${distance} km em um carro a diesel emite aproximadamente ${emissions.toFixed(1)} kg de CO₂.`;
            break;
        case 'car-electric':
            message = `Dirigindo ${distance} km em um carro elétrico emite aproximadamente ${emissions.toFixed(1)} kg de CO₂ (considerando a matriz energética).`;
            break;
        case 'bus':
            message = `Viajando ${distance} km de ônibus emite aproximadamente ${emissions.toFixed(1)} kg de CO₂.`;
            break;
        case 'bike':
            message = `Pedalar ${distance} km não emite CO₂! Excelente escolha ecológica.`;
            break;
        case 'walking':
            message = `Caminhar ${distance} km não emite CO₂ e é ótimo para sua saúde!`;
            break;
    }
    
    document.getElementById('calc-result').innerHTML = message;
}
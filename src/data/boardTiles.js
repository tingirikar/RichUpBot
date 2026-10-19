/**
 * RICHUP.IO 40-TILE BOARD DATABASE & MARKOV PROBABILITIES
 * 
 * Stationary Markov probabilities account for 2d6 dice distribution,
 * Jail attraction spike (Tile 10 is the #1 visited tile on the board),
 * and Chance/Surprise relocation cards.
 * 
 * Verified against RichUp.io live game boards:
 * - Haifa: $110 (Tile 7)
 * - Surprise: Tile 8
 * - Venice: $130 (Tile 11)
 * - Power Company: $150 (Tile 12)
 * - NUC Airport: $200 (Tile 15)
 * - Munich: $190 (Tile 18)
 * - Shenzhen: $210 (Tile 21)
 * - Water Company: $150 (Tile 27)
 * - Toulouse: $270 (Tile 28)
 */

export const BOARD_TILES = [
    { id: 0,  name: 'Start',            type: 'special',  group: null,      price: 0,   houseCost: 0,   rent: [0],                            markov: 0.0309 },
    { id: 1,  name: 'Salvador',         type: 'property', group: 'Brazil',  price: 60,  houseCost: 50,  rent: [2, 10, 30, 90, 160, 250],      markov: 0.0213 },
    { id: 2,  name: 'Treasure',         type: 'card',     group: null,      price: 0,   houseCost: 0,   rent: [0],                            markov: 0.0188 },
    { id: 3,  name: 'Rio',              type: 'property', group: 'Brazil',  price: 60,  houseCost: 50,  rent: [4, 20, 60, 180, 320, 450],     markov: 0.0216 },
    { id: 4,  name: 'Earnings Tax',     type: 'tax',      group: null,      price: 200, houseCost: 0,   rent: [200],                          markov: 0.0233 },
    { id: 5,  name: 'TLV Airport',      type: 'airport',  group: 'Airport', price: 200, houseCost: 0,   rent: [25, 50, 100, 200],             markov: 0.0296 },
    { id: 6,  name: 'Tel Aviv',         type: 'property', group: 'Israel',  price: 100, houseCost: 50,  rent: [6, 30, 90, 270, 400, 550],     markov: 0.0226 },
    { id: 7,  name: 'Haifa',            type: 'property', group: 'Israel',  price: 110, houseCost: 50,  rent: [7, 35, 100, 300, 450, 600],    markov: 0.0232 },
    { id: 8,  name: 'Surprise',         type: 'card',     group: null,      price: 0,   houseCost: 0,   rent: [0],                            markov: 0.0086 },
    { id: 9,  name: 'Jerusalem',        type: 'property', group: 'Israel',  price: 120, houseCost: 50,  rent: [8, 40, 100, 300, 450, 600],    markov: 0.0230 },
    { id: 10, name: 'In Prison',        type: 'jail',     group: null,      price: 0,   houseCost: 0,   rent: [0],                            markov: 0.0589 },
    { id: 11, name: 'Venice',           type: 'property', group: 'Italy',   price: 130, houseCost: 100, rent: [10, 50, 150, 450, 625, 750],   markov: 0.0270 },
    { id: 12, name: 'Power Company',    type: 'utility',  group: 'Utility', price: 150, houseCost: 0,   rent: [28, 70],                       markov: 0.0260 },
    { id: 13, name: 'Milan',            type: 'property', group: 'Italy',   price: 140, houseCost: 100, rent: [10, 50, 150, 450, 625, 750],   markov: 0.0237 },
    { id: 14, name: 'Rome',             type: 'property', group: 'Italy',   price: 160, houseCost: 100, rent: [12, 60, 180, 500, 700, 900],   markov: 0.0246 },
    { id: 15, name: 'NUC Airport',      type: 'airport',  group: 'Airport', price: 200, houseCost: 0,   rent: [25, 50, 100, 200],             markov: 0.0292 },
    { id: 16, name: 'Frankfurt',        type: 'property', group: 'Germany', price: 180, houseCost: 100, rent: [14, 70, 200, 550, 750, 950],   markov: 0.0279 },
    { id: 17, name: 'Treasure',         type: 'card',     group: null,      price: 0,   houseCost: 0,   rent: [0],                            markov: 0.0259 },
    { id: 18, name: 'Munich',           type: 'property', group: 'Germany', price: 190, houseCost: 100, rent: [15, 75, 200, 550, 750, 950],   markov: 0.0293 },
    { id: 19, name: 'Berlin',           type: 'property', group: 'Germany', price: 200, houseCost: 100, rent: [16, 80, 220, 600, 800, 1000],  markov: 0.0308 },
    { id: 20, name: 'Vacation',         type: 'special',  group: null,      price: 0,   houseCost: 0,   rent: [0],                            markov: 0.0288 },
    { id: 21, name: 'Shenzhen',         type: 'property', group: 'China',   price: 210, houseCost: 150, rent: [17, 85, 240, 670, 840, 1025],  markov: 0.0283 },
    { id: 22, name: 'Surprise',         type: 'card',     group: null,      price: 0,   houseCost: 0,   rent: [0],                            markov: 0.0104 },
    { id: 23, name: 'Beijing',          type: 'property', group: 'China',   price: 220, houseCost: 150, rent: [18, 90, 250, 700, 875, 1050],  markov: 0.0273 },
    { id: 24, name: 'Shanghai',         type: 'property', group: 'China',   price: 240, houseCost: 150, rent: [20, 100, 300, 750, 925, 1100], markov: 0.0318 },
    { id: 25, name: 'CDG Airport',      type: 'airport',  group: 'Airport', price: 200, houseCost: 0,   rent: [25, 50, 100, 200],             markov: 0.0306 },
    { id: 26, name: 'Lyon',             type: 'property', group: 'France',  price: 260, houseCost: 150, rent: [22, 110, 330, 800, 975, 1150], markov: 0.0270 },
    { id: 27, name: 'Water Company',    type: 'utility',  group: 'Utility', price: 150, houseCost: 0,   rent: [28, 70],                       markov: 0.0281 },
    { id: 28, name: 'Toulouse',         type: 'property', group: 'France',  price: 270, houseCost: 150, rent: [23, 115, 345, 825, 1000, 1175],markov: 0.0268 },
    { id: 29, name: 'Paris',            type: 'property', group: 'France',  price: 280, houseCost: 150, rent: [24, 120, 360, 850, 1025, 1200],markov: 0.0258 },
    { id: 30, name: 'Go to prison',     type: 'gotojail', group: null,      price: 0,   houseCost: 0,   rent: [0],                            markov: 0.0000 },
    { id: 31, name: 'Liverpool',        type: 'property', group: 'UK',      price: 300, houseCost: 200, rent: [26, 130, 390, 900, 1100, 1275],markov: 0.0267 },
    { id: 32, name: 'Manchester',       type: 'property', group: 'UK',      price: 300, houseCost: 200, rent: [26, 130, 390, 900, 1100, 1275],markov: 0.0262 },
    { id: 33, name: 'London',           type: 'property', group: 'UK',      price: 320, houseCost: 200, rent: [28, 150, 450, 1000, 1200, 1400],markov: 0.0250 },
    { id: 34, name: 'JFK Airport',      type: 'airport',  group: 'Airport', price: 200, houseCost: 0,   rent: [25, 50, 100, 200],             markov: 0.0243 },
    { id: 35, name: 'Surprise',         type: 'card',     group: null,      price: 0,   houseCost: 0,   rent: [0],                            markov: 0.0086 },
    { id: 36, name: 'San Francisco',    type: 'property', group: 'USA',     price: 350, houseCost: 200, rent: [35, 175, 500, 1100, 1300, 1500],markov: 0.0218 },
    { id: 37, name: 'Treasure',         type: 'card',     group: null,      price: 0,   houseCost: 0,   rent: [0],                            markov: 0.0236 },
    { id: 38, name: 'Luxury Tax',       type: 'tax',      group: null,      price: 75,  houseCost: 0,   rent: [75],                           markov: 0.0217 },
    { id: 39, name: 'New York',         type: 'property', group: 'USA',     price: 400, houseCost: 200, rent: [50, 200, 600, 1400, 1700, 2000],markov: 0.0263 }
];

export const GROUP_TILES = Object.freeze(
    BOARD_TILES.reduce((acc, tile) => {
        if (tile.group) {
            if (!acc[tile.group]) acc[tile.group] = [];
            acc[tile.group].push(tile);
        }
        return acc;
    }, {})
);

export const TILE_BY_NAME = Object.freeze(
    BOARD_TILES.reduce((acc, tile) => {
        acc[tile.name.toLowerCase()] = tile;
        return acc;
    }, {
        // Aliases for RichUp alternate names
        'electric company': BOARD_TILES[12],
        'muc airport': BOARD_TILES[15],
        'income tax': BOARD_TILES[4]
    })
);

export const TILE_BY_ID = Object.freeze(
    BOARD_TILES.reduce((acc, tile) => {
        acc[tile.id] = tile;
        return acc;
    }, {})
);

// High-traffic, deadly color sets in Monopoly (landing right out of Jail)
export const HIGH_TRAFFIC_GROUPS = new Set(['Germany', 'China', 'France', 'Italy']);

// Blacklist of board & UI labels so DOM cash scraper never mistakes system UI for player username or cash
export const BOARD_LABELS_BLACKLIST = new Set([
    ...BOARD_TILES.map(t => t.name.toLowerCase()),
    'start', 'passing by', 'in prison', 'vacation', 'go to prison', 'treasure',
    'surprise', 'income tax', 'earnings tax', 'luxury tax', 'electric', 'water', 'company',
    'airport', 'collect', 'on hold', 'trades', 'bankrupt', 'votekick', 'buy', 'sell',
    'connection lost', 'disconnected', 'reconnecting', 'server error', 'ping',
    'advisor', 'auto-pilot', 'danger ev', 'survival reserve', 'position', 'my name', 'cash',
    'store', 'shop', 'inventory', 'profile', 'settings', 'rules', 'lobby', 'room', 'host',
    'change appearance', 'waiting for', 'joined the game', 'start the game', 'is playing',
    'good luck', 'even build', 'starting cash', 'randomize player order', 'create'
]);

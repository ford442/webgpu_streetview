export interface CryptoCompany {
  name: string;
  lat: number;
  lng: number;
  description: string;
}

export const CRYPTO_COMPANIES: CryptoCompany[] = [
  { name: "Coinbase", lat: 37.7749, lng: -122.4194, description: "Major US Crypto Exchange" },
  { name: "Binance", lat: 19.3133, lng: -81.2546, description: "Global Crypto Exchange" },
  { name: "Kraken", lat: 37.7749, lng: -122.4194, description: "Cryptocurrency Exchange" },
  { name: "Bitmain", lat: 39.9042, lng: 116.4074, description: "Bitcoin Mining Hardware" },
  { name: "Riot Blockchain", lat: 39.3722, lng: -104.8561, description: "Bitcoin Mining Company" },
  { name: "Gemini", lat: 40.7505, lng: -73.9934, description: "Cryptocurrency Exchange" },
  { name: "Huobi", lat: 1.3521, lng: 103.8198, description: "Global Crypto Exchange" },
  { name: "OKX", lat: 22.3193, lng: 114.1694, description: "Cryptocurrency Exchange" },
  { name: "Bybit", lat: 22.3193, lng: 114.1694, description: "Cryptocurrency Derivatives" },
  { name: "FTX", lat: 25.7617, lng: -80.1918, description: "Cryptocurrency Exchange (Bankrupt)" },
];
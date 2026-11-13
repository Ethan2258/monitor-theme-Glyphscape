/**
 * Where a country's marker sits on the globe: latitude and longitude of its
 * capital, or of the city its servers are usually in where the two differ and
 * the country is large (Frankfurt, Mumbai, São Paulo, Sydney). The United States
 * takes its middle, since no one city stands for both coasts.
 *
 * A tile on the globe covers three to five degrees, so a degree either way does
 * not show. A code missing from here simply has no marker; its nodes are still
 * listed under the globe.
 */
const PLACES: Record<string, [number, number]> = {
  // East Asia
  CN: [39.9, 116.4], HK: [22.3, 114.2], MO: [22.2, 113.5], TW: [25.0, 121.5], JP: [35.7, 139.7],
  KR: [37.6, 127.0], KP: [39.0, 125.8], MN: [47.9, 106.9],
  // South-East Asia
  SG: [1.35, 103.8], MY: [3.1, 101.7], TH: [13.8, 100.5], VN: [21.0, 105.8], PH: [14.6, 121.0],
  ID: [-6.2, 106.8], KH: [11.6, 104.9], LA: [18.0, 102.6], MM: [19.8, 96.1], BN: [4.9, 114.9], TL: [-8.6, 125.6],
  // South and Central Asia
  IN: [19.1, 72.9], PK: [33.7, 73.1], BD: [23.8, 90.4], LK: [6.9, 79.9], NP: [27.7, 85.3], BT: [27.5, 89.6],
  MV: [4.2, 73.5], AF: [34.5, 69.2], KZ: [51.2, 71.4], UZ: [41.3, 69.3], KG: [42.9, 74.6], TJ: [38.6, 68.8],
  TM: [37.9, 58.4],
  // West Asia
  AE: [25.2, 55.3], SA: [24.7, 46.7], QA: [25.3, 51.5], KW: [29.4, 48.0], BH: [26.2, 50.6], OM: [23.6, 58.4],
  YE: [15.4, 44.2], IL: [32.1, 34.8], PS: [31.9, 35.2], JO: [31.9, 35.9], LB: [33.9, 35.5], SY: [33.5, 36.3],
  IQ: [33.3, 44.4], IR: [35.7, 51.4], TR: [41.0, 29.0], CY: [35.2, 33.4], GE: [41.7, 44.8], AM: [40.2, 44.5],
  AZ: [40.4, 49.9],
  // Europe
  GB: [51.5, -0.1], IE: [53.3, -6.3], FR: [48.9, 2.4], DE: [50.1, 8.7], NL: [52.4, 4.9], BE: [50.8, 4.4],
  LU: [49.6, 6.1], CH: [47.4, 8.5], AT: [48.2, 16.4], LI: [47.1, 9.5], MC: [43.7, 7.4], ES: [40.4, -3.7],
  PT: [38.7, -9.1], AD: [42.5, 1.5], IT: [41.9, 12.5], MT: [35.9, 14.5], SM: [43.9, 12.4], VA: [41.9, 12.45],
  GR: [38.0, 23.7], AL: [41.3, 19.8], MK: [42.0, 21.4], RS: [44.8, 20.5], ME: [42.4, 19.3], BA: [43.9, 18.4],
  HR: [45.8, 16.0], SI: [46.1, 14.5], XK: [42.7, 21.2], BG: [42.7, 23.3], RO: [44.4, 26.1], MD: [47.0, 28.9],
  UA: [50.5, 30.5], BY: [53.9, 27.6], PL: [52.2, 21.0], CZ: [50.1, 14.4], SK: [48.1, 17.1], HU: [47.5, 19.0],
  LT: [54.7, 25.3], LV: [56.9, 24.1], EE: [59.4, 24.8], FI: [60.2, 24.9], SE: [59.3, 18.1], NO: [59.9, 10.8],
  DK: [55.7, 12.6], IS: [64.1, -21.9], FO: [62.0, -6.8], GI: [36.1, -5.4], IM: [54.2, -4.5], JE: [49.2, -2.1],
  GG: [49.5, -2.5], RU: [55.75, 37.6], GL: [64.2, -51.7],
  // North and Central America, the Caribbean
  US: [39.0, -97.0], CA: [45.4, -75.7], MX: [19.4, -99.1], GT: [14.6, -90.5], BZ: [17.3, -88.8],
  SV: [13.7, -89.2], HN: [14.1, -87.2], NI: [12.1, -86.3], CR: [9.9, -84.1], PA: [9.0, -79.5], CU: [23.1, -82.4],
  JM: [18.0, -76.8], HT: [18.5, -72.3], DO: [18.5, -69.9], PR: [18.4, -66.1], BS: [25.1, -77.3],
  BB: [13.1, -59.6], TT: [10.7, -61.5], BM: [32.3, -64.8], KY: [19.3, -81.4], VG: [18.4, -64.6],
  VI: [18.3, -64.9], CW: [12.1, -68.9], AW: [12.5, -70.0],
  // South America
  BR: [-23.5, -46.6], AR: [-34.6, -58.4], CL: [-33.4, -70.7], CO: [4.7, -74.1], PE: [-12.0, -77.0],
  VE: [10.5, -66.9], EC: [-0.2, -78.5], BO: [-16.5, -68.1], PY: [-25.3, -57.6], UY: [-34.9, -56.2],
  GY: [6.8, -58.2], SR: [5.9, -55.2], GF: [4.9, -52.3],
  // Africa
  ZA: [-26.2, 28.0], EG: [30.0, 31.2], NG: [6.5, 3.4], KE: [-1.3, 36.8], MA: [34.0, -6.8], DZ: [36.8, 3.1],
  TN: [36.8, 10.2], LY: [32.9, 13.2], ET: [9.0, 38.7], GH: [5.6, -0.2], CI: [5.3, -4.0], SN: [14.7, -17.4],
  TZ: [-6.8, 39.3], UG: [0.3, 32.6], RW: [-1.9, 30.1], AO: [-8.8, 13.2], MZ: [-25.9, 32.6], ZM: [-15.4, 28.3],
  ZW: [-17.8, 31.0], BW: [-24.7, 25.9], NA: [-22.6, 17.1], MU: [-20.2, 57.5], SC: [-4.6, 55.5],
  MG: [-18.9, 47.5], CM: [3.9, 11.5], CD: [-4.3, 15.3], CG: [-4.3, 15.2], SD: [15.6, 32.5], RE: [-20.9, 55.5],
  DJ: [11.6, 43.1], SO: [2.0, 45.3], ML: [12.6, -8.0], BF: [12.4, -1.5], NE: [13.5, 2.1], TD: [12.1, 15.0],
  BJ: [6.5, 2.6], TG: [6.1, 1.2], GA: [0.4, 9.5], MW: [-14.0, 33.8], LS: [-29.3, 27.5], SZ: [-26.3, 31.1],
  GM: [13.5, -16.6], GN: [9.6, -13.6], SL: [8.5, -13.2], LR: [6.3, -10.8], MR: [18.1, -15.9],
  CV: [14.9, -23.5], BI: [-3.4, 29.4], SS: [4.9, 31.6], ER: [15.3, 38.9],
  // Oceania
  AU: [-33.9, 151.2], NZ: [-36.8, 174.8], FJ: [-18.1, 178.4], PG: [-9.4, 147.2], NC: [-22.3, 166.5],
  PF: [-17.5, -149.6], GU: [13.5, 144.8], WS: [-13.8, -171.8], TO: [-21.1, -175.2], VU: [-17.7, 168.3],
  SB: [-9.4, 160.0],
}

/** Latitude and longitude for a country code, or undefined for one this table lacks. */
export function placeOf(code: string): [number, number] | undefined {
  return PLACES[code.toUpperCase()]
}

// Built on first use. The short style is what gives 香港 rather than
// 中国香港特别行政区; a browser without Intl.DisplayNames gets the code back.
let names: Intl.DisplayNames | null | undefined

/** The country's name as zh-CN writes it, or the code itself where the browser has none. */
export function countryName(code: string): string {
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames(["zh-CN"], { type: "region", style: "short" })
    } catch {
      names = null
    }
  }
  try {
    return names?.of(code.toUpperCase()) ?? code
  } catch {
    // `of` throws on anything that is not a region code, and the hub only checks
    // the length of what an operator types.
    return code
  }
}

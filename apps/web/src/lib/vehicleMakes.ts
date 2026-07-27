// No make/model catalogue exists in the DB -- every Make/Model field in this
// app (VehiclesPage.tsx, etc.) is plain free text. This is a small reference
// list shared by both ESP registration surfaces (public /esp/:slug page and
// staff walk-in registration) so a rider whose brand isn't listed still has
// an "Other" escape hatch instead of being blocked.
export const OTHER = '__other__'

export const BIKE_MAKES: Record<string, string[]> = {
  'Honda': ['CBR500R', 'CB500X', 'Africa Twin', 'Rebel 500', 'Gold Wing', 'CB650R', 'Forza 350', 'EX5', 'RS150R'],
  'Yamaha': ['YZF-R15', 'YZF-R25', 'MT-15', 'MT-25', 'NMAX', 'XMAX', 'Y15ZR', 'Lagenda', 'Tenere 700'],
  'Kawasaki': ['Ninja 250', 'Ninja 400', 'Ninja 650', 'Z650', 'Versys 650', 'Vulcan S'],
  'Suzuki': ['GSX-R150', 'GSX-S150', 'V-Strom 250', 'Burgman'],
  'Harley-Davidson': ['Sportster S', 'Iron 883', 'Forty-Eight', 'Seventy-Two', 'Nightster', 'Street Bob', 'Fat Bob', 'Low Rider', 'Low Rider S', 'Breakout', 'Fat Boy', 'Road King', 'Street Glide', 'Road Glide', 'Ultra Limited', 'Pan America'],
  'Ducati': ['Monster', 'Scrambler', 'Panigale V2', 'Panigale V4', 'Multistrada', 'Diavel'],
  'BMW Motorrad': ['G 310 R', 'G 310 GS', 'F 850 GS', 'R 1250 GS', 'S 1000 RR'],
  'Royal Enfield': ['Classic 350', 'Meteor 350', 'Himalayan', 'Interceptor 650', 'Continental GT 650'],
  'Triumph': ['Street Triple', 'Speed Triple', 'Bonneville T100', 'Tiger 900', 'Trident 660'],
  'KTM': ['Duke 200', 'Duke 250', 'Duke 390', 'RC 390', 'Adventure 390'],
  'Modenas': ['Pulsar NS200', 'V15', 'Dominar 400', 'Kriss'],
  'SYM': ['VF3', 'Jet 14', 'Cruisym'],
  'Vespa': ['Primavera', 'Sprint', 'GTS'],
  'Benelli': ['Leoncino 500', 'TRK 502'],
  'CFMoto': ['300NK', '450NK', '700CL-X'],
}

export const CAR_MAKES: Record<string, string[]> = {
  'Perodua': ['Axia', 'Bezza', 'Myvi', 'Alza', 'Aruz', 'Ativa'],
  'Proton': ['Saga', 'Persona', 'Iriz', 'Exora', 'X50', 'X70', 'X90', 'S70'],
  'Toyota': ['Vios', 'Yaris', 'Corolla Altis', 'Camry', 'Innova', 'Fortuner', 'Hilux', 'Alphard', 'Avanza', 'RAV4'],
  'Honda': ['City', 'Civic', 'Accord', 'HR-V', 'CR-V', 'BR-V', 'Jazz'],
  'Nissan': ['Almera', 'X-Trail', 'Navara', 'Serena'],
  'Mazda': ['Mazda 2', 'Mazda 3', 'CX-3', 'CX-5', 'CX-8'],
  'Mitsubishi': ['Attrage', 'Triton', 'Xpander', 'ASX', 'Outlander'],
  'Hyundai': ['Elantra', 'Tucson', 'Santa Fe', 'Ioniq 5'],
  'Kia': ['Picanto', 'Sportage', 'Sorento', 'Carnival'],
  'BMW': ['1 Series', '3 Series', '5 Series', 'X1', 'X3', 'X5'],
  'Mercedes-Benz': ['A-Class', 'C-Class', 'E-Class', 'GLA', 'GLC'],
  'Volkswagen': ['Vento', 'Golf', 'Passat', 'Tiguan'],
  'Ford': ['Ranger', 'Everest', 'Territory'],
  'Suzuki': ['Swift', 'Ertiga'],
  'Isuzu': ['D-Max', 'MU-X'],
  'MINI': ['Cooper', 'Countryman'],
  'Volvo': ['XC40', 'XC60', 'XC90', 'S60'],
}

export function makeOptionsFor(type: 'car' | 'bike'): string[] {
  return Object.keys(type === 'bike' ? BIKE_MAKES : CAR_MAKES)
}
export function modelOptionsFor(type: 'car' | 'bike', make: string): string[] {
  return (type === 'bike' ? BIKE_MAKES : CAR_MAKES)[make] ?? []
}

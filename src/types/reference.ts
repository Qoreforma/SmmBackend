export interface ICity {
  id: number;
  name: string;
  state_id: number;
  state_code: string;
  country_id: number;
  country_code: string;
  latitude: string;
  longitude: string;
}
export interface IState {
  id: number;
  name: string;
  country_id: number;
  country_code: string;
  iso2: string;
  longitude: string;
  latitude: string;
}

export interface ICountry {
  id: number;
  name: string;
  numeric_code: string;
  iso2: string;
  iso3: string;
  phonecode: string;
  region: string;
  emoji: string;
  emojiU: string;
  capital: string;
  currency: string;
  currency_name: string;
  currency_symbol: string;
  longitude: string;
  latitude: string;
}

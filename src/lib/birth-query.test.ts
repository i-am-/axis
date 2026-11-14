import { describe, it, expect } from 'vitest';
import { birthQuery, readBirthQuery } from './birth-query';

const place = {
  name: 'Dublin', region: 'Leinster', country: 'Ireland', country_code: 'IE',
  latitude: 53.34399, longitude: -6.26719, time_zone: 'Europe/Dublin', matched_name: 'Dublin',
};

describe('birth query', () => {
  it('round-trips date, time and place', () => {
    const q = birthQuery({ date: '1990-06-15', time: '14:30', place }, 'Dublin, Leinster, Ireland');
    expect(q).toBe('?d=1990-06-15&t=14%3A30&n=Dublin%2C+Leinster%2C+Ireland&lat=53.3440&lon=-6.2672&tz=Europe%2FDublin');
    const b = readBirthQuery(q)!;
    expect(b.date).toBe('1990-06-15');
    expect(b.time).toBe('14:30');
    expect(b.place).toMatchObject({ name: 'Dublin, Leinster, Ireland', latitude: 53.344, longitude: -6.2672, time_zone: 'Europe/Dublin' });
  });
  it('time may be absent', () => {
    expect(readBirthQuery('?d=1990-06-15&n=X&lat=1&lon=2&tz=UTC')!.time).toBeNull();
  });
  it('rejects broken input', () => {
    expect(readBirthQuery('')).toBeNull();
    expect(readBirthQuery('?d=1990-6-15&n=X&lat=1&lon=2&tz=UTC')).toBeNull();
    expect(readBirthQuery('?d=1990-06-15&t=25:00&n=X&lat=1&lon=2&tz=UTC')).toBeNull();
    expect(readBirthQuery('?d=1990-06-15&n=X&lat=91&lon=2&tz=UTC')).toBeNull();
    expect(readBirthQuery('?d=1990-06-15&lat=1&lon=2&tz=UTC')).toBeNull();
  });
});

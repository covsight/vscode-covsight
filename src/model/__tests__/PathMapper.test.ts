import { PathMapper } from '../PathMapper';

describe('PathMapper', () => {
  it('map() replaces exact prefix matches', () => {
    const mapper = new PathMapper({ '/db': '/ws' });
    expect(mapper.map('/db/file.sv')).toBe('/ws/file.sv');
  });

  it('map() uses the longest matching prefix', () => {
    const mapper = new PathMapper({ '/db': '/ws', '/db/sub': '/alt' });
    expect(mapper.map('/db/sub/file.sv')).toBe('/alt/file.sv');
  });

  it('map() returns null when no mapping matches', () => {
    const mapper = new PathMapper({ '/db': '/ws' });
    expect(mapper.map('/other/file.sv')).toBeNull();
  });

  it('map() returns null for empty mappings', () => {
    const mapper = new PathMapper({});
    expect(mapper.map('/db/file.sv')).toBeNull();
  });

  it('mapOrPassthrough() returns the original path when no match exists', () => {
    const mapper = new PathMapper({ '/db': '/ws' });
    expect(mapper.mapOrPassthrough('/other/file.sv')).toBe('/other/file.sv');
  });

  it('mapOrPassthrough() replaces matched prefixes', () => {
    const mapper = new PathMapper({ '/db': '/ws' });
    expect(mapper.mapOrPassthrough('/db/file.sv')).toBe('/ws/file.sv');
  });

  it('updateMappings() applies new mappings immediately', () => {
    const mapper = new PathMapper({ '/db': '/ws' });
    mapper.updateMappings({ '/sim': '/workspace' });
    expect(mapper.map('/db/file.sv')).toBeNull();
    expect(mapper.map('/sim/file.sv')).toBe('/workspace/file.sv');
  });

  it('fromConfig() creates an equivalent mapper', () => {
    const mapper = PathMapper.fromConfig({ '/db': '/ws' });
    expect(mapper.map('/db/file.sv')).toBe('/ws/file.sv');
  });

  it('supports prefixes with trailing slashes', () => {
    const mapper = new PathMapper({ '/foo/': '/bar/' });
    expect(mapper.map('/foo/bar.sv')).toBe('/bar/bar.sv');
  });
});

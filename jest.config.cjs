module.exports = {
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      tsconfig: { module: 'ES2022', moduleResolution: 'bundler' },
    }],
  },
  testEnvironment: 'node',
  testMatch: [
    '**/src/model/__tests__/**/*.test.ts',
    '**/src/views/html/**/*.test.ts',
  ],
  moduleNameMapper: {
    '^@covsight/core(.*)$': '<rootDir>/packages/covsight-core/ts/dist$1/index.js',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  coverageThreshold: {
    global: { lines: 90, functions: 90, branches: 85 },
  },
};

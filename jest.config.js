module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/server/test/setup.js'],
  testMatch: ['<rootDir>/server/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'server/routes/**/*.js',
    'server/services/**/*.js',
    'server/middleware/**/*.js',
    '!node_modules/**',
    '!server/test/**',
    '!server/__tests__/**'
  ],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50
    }
  }
}

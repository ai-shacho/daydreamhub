module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jest-environment-jsdom',
  transform: {
    '^.+\\.(ts|tsx)?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    '^.+\\.jsx?$': 'babel-jest'
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  // Only files named *.test.* or *.spec.* are suites. The old first pattern
  // swept in everything under test/, so the hand-run scripts living there
  // (renderMarkdownTest.js and friends) were loaded as test files and failed to
  // parse — red suites that were never tests at all.
  testMatch: ['**/?(*.)+(spec|test).[tj]s?(x)'],

  roots: ['<rootDir>/src', '<rootDir>/test'],
  verbose: true,
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/playwright/']
};
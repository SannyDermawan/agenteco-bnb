import { test } from 'node:test'
import assert from 'node:assert/strict'
import { InvalidInputError, computeStats, parseCsv } from './dataAnalysis.ts'
import { toCoinMarkets } from './cryptoMarket.ts'

test('parseCsv handles quotes, escaped quotes, embedded commas/newlines and CRLF', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\n"multi\nline",2\n\n'), [
    ['a', 'b'],
    ['x, y', 'say "hi"'],
    ['multi\nline', '2'],
  ])
})

test('computeStats: count, mean, median, min, max and population stddev per numeric column', () => {
  const stats = computeStats('name,score,weight\nA,10,1.5\nB,20,2.5\nC,30,\nD,40,3.5')
  assert.equal(stats.rows, 4)
  assert.deepEqual(stats.columns, ['name', 'score', 'weight'])
  const score = stats.numeric.find((c) => c.column === 'score')!
  assert.deepEqual(score, { column: 'score', count: 4, mean: 25, median: 25, min: 10, max: 40, stddev: 11.1803 })
  const weight = stats.numeric.find((c) => c.column === 'weight')!
  assert.equal(weight.count, 3, 'empty cells are skipped')
  assert.equal(weight.median, 2.5)
  assert.equal(stats.numeric.some((c) => c.column === 'name'), false)
})

test('computeStats reads money and percent formats as numbers', () => {
  const stats = computeStats('item,price\na,"$1,200"\nb,15%')
  assert.deepEqual(stats.numeric[0].min, 15)
  assert.deepEqual(stats.numeric[0].max, 1200)
})

test('computeStats: first→last trend over a date column, in date order', () => {
  const stats = computeStats('month,revenue\n2026-03-01,150\n2026-01-01,100\n2026-02-01,120')
  assert.deepEqual(stats.trends, [
    {
      dateColumn: 'month',
      valueColumn: 'revenue',
      firstDate: '2026-01-01',
      lastDate: '2026-03-01',
      firstValue: 100,
      lastValue: 150,
      changePct: 50,
      direction: 'up',
    },
  ])
})

test('computeStats enforces the row and column limits and needs a numeric column', () => {
  const tooManyRows = ['n', ...Array.from({ length: 201 }, (_, i) => String(i))].join('\n')
  assert.throws(() => computeStats(tooManyRows), InvalidInputError)
  const tooManyCols = `${Array.from({ length: 21 }, (_, i) => `c${i}`).join(',')}\n${Array(21).fill('1').join(',')}`
  assert.throws(() => computeStats(tooManyCols), /21 columns/)
  assert.throws(() => computeStats('a,b\nx,y'), /no numeric column/)
  assert.throws(() => computeStats('only_header'), /header row and at least one data row/)
})

test('toCoinMarkets maps CoinGecko rows and keeps missing values as null', () => {
  assert.deepEqual(
    toCoinMarkets([
      { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 85000, price_change_percentage_24h_in_currency: 1.5, total_volume: null, market_cap: 10 },
    ]),
    [{ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', priceUsd: 85000, change24hPct: 1.5, change7dPct: null, volume24hUsd: null, marketCapUsd: 10 }]
  )
})

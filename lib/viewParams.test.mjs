import test from 'node:test'
import assert from 'node:assert/strict'
import { parseViewParams, DEFAULT_POLL_S } from './viewParams.js'

const COINS = ['CUP', 'CASH', 'MLC', 'CLASICA', 'ETECSA', 'TROPICAL', 'GAS']
const parse = (query) => parseViewParams(new URLSearchParams(query), { coins: COINS })

const DEFAULTS = {
	stream: false, code: true, game: true, push: true, offers: true, footer: true, chart: true,
	currency: 'CUP', rotate: 0, theme: null, fx: 'full', poll: DEFAULT_POLL_S,
}

test('sin parámetros, todo queda como hoy', () => {
	assert.deepEqual(parse(''), DEFAULTS)
})

test('nocode y nogame: solo el valor exacto true, e independientes', () => {
	assert.deepEqual(parse('nocode=true'), { ...DEFAULTS, code: false })
	assert.deepEqual(parse('nogame=true'), { ...DEFAULTS, game: false })
	assert.deepEqual(parse('nocode=true&nogame=true'), { ...DEFAULTS, code: false, game: false })
	for (const value of ['1', 'TRUE', 'yes', '', 'false']) {
		assert.deepEqual(parse(`nocode=${value}&nogame=${value}`), DEFAULTS, `nocode=${value}`)
	}
})

test('los booleanos nuevos aceptan true/1/false/0 e ignoran el resto', () => {
	for (const key of ['code', 'game', 'push', 'offers', 'footer', 'chart']) {
		assert.equal(parse(`${key}=false`)[key], false)
		assert.equal(parse(`${key}=0`)[key], false)
		assert.equal(parse(`${key}=true`)[key], true)
		assert.equal(parse(`${key}=1`)[key], true)
		assert.equal(parse(`${key}=no`)[key], true)
		assert.equal(parse(`${key}=`)[key], true)
	}
})

test('el parámetro nuevo gana al histórico', () => {
	assert.equal(parse('nocode=true&code=true').code, true)
	assert.equal(parse('nogame=true&game=1').game, true)
})

test('stream aplica el preset', () => {
	const preset = {
		...DEFAULTS, stream: true, code: false, game: false, push: false, footer: false,
		theme: 'dark', fx: 'low', rotate: 10,
	}
	assert.deepEqual(parse('stream=true'), preset)
	assert.deepEqual(parse('stream=1'), preset)
	assert.deepEqual(parse('stream=false'), DEFAULTS)
	assert.deepEqual(parse('stream=si'), DEFAULTS)
})

test('un parámetro explícito gana al preset', () => {
	const view = parse('stream=true&chart=true&rotate=20&currency=MLC')
	assert.equal(view.stream, true)
	assert.equal(view.chart, true)
	assert.equal(view.rotate, 20)
	assert.equal(view.currency, 'MLC')
	assert.equal(view.fx, 'low')

	assert.equal(parse('stream=true&offers=false').offers, false)
	assert.equal(parse('stream=true&theme=light').theme, 'light')
	assert.equal(parse('stream=true&fx=full').fx, 'full')
	assert.equal(parse('stream=true&rotate=0').rotate, 0)
	assert.equal(parse('stream=true&chart=false').chart, false)
})

test('currency: sin distinguir mayúsculas, y las que no existen se ignoran', () => {
	assert.equal(parse('currency=mlc').currency, 'MLC')
	assert.equal(parse('currency=GAS').currency, 'GAS')
	assert.equal(parse('currency=EUR').currency, 'CUP')
	assert.equal(parse('currency=').currency, 'CUP')
})

test('rotate: mínimo 5, 0 lo apaga, lo inválido se ignora', () => {
	assert.equal(parse('rotate=15').rotate, 15)
	assert.equal(parse('rotate=2').rotate, 5)
	assert.equal(parse('rotate=999999').rotate, 3600)
	assert.equal(parse('rotate=0').rotate, 0)
	assert.equal(parse('rotate=false').rotate, 0)
	for (const value of ['abc', '-5', '1.5', '', '10s']) {
		assert.equal(parse(`rotate=${value}`).rotate, 0, `rotate=${value}`)
		assert.equal(parse(`stream=true&rotate=${value}`).rotate, 10, `stream + rotate=${value}`)
	}
})

test('poll: mínimo 30, lo inválido deja el actual', () => {
	assert.equal(parse('poll=60').poll, 60)
	assert.equal(parse('poll=5').poll, 30)
	assert.equal(parse('poll=0').poll, 30)
	assert.equal(parse('poll=abc').poll, DEFAULT_POLL_S)
	assert.equal(parse('poll=').poll, DEFAULT_POLL_S)
})

test('theme y fx: solo sus valores', () => {
	assert.equal(parse('theme=dark').theme, 'dark')
	assert.equal(parse('theme=LIGHT').theme, 'light')
	assert.equal(parse('theme=blue').theme, null)
	assert.equal(parse('fx=low').fx, 'low')
	assert.equal(parse('fx=ultra').fx, 'full')
})

test('acepta también un objeto de searchParams o un query string', () => {
	assert.equal(parseViewParams({ stream: 'true', currency: ['MLC', 'CUP'] }, { coins: COINS }).currency, 'MLC')
	assert.equal(parseViewParams('?nogame=true', { coins: COINS }).game, false)
	assert.deepEqual(parseViewParams(undefined, { coins: COINS }), DEFAULTS)
})

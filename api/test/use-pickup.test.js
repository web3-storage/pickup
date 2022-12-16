import test from 'ava'
import { usePickup } from '../basic/add-pin-route.js'

test('usePickup with rate of 5', async t => {
  let isTrue = 0
  const NUM_TEST = 100
  const RATE = 5
  for (let i = 0; i < NUM_TEST * 100; i++) {
    if (usePickup(RATE)) {
      isTrue++
    }
  }

  // The function works with a random number, it's tested using range of error of the 30%
  t.true(isTrue / NUM_TEST > RATE * 0.70)
  t.true(isTrue / NUM_TEST < RATE * 1.30)
})

test('usePickup with rate of 20', async t => {
  let isTrue = 0
  const NUM_TEST = 100
  const RATE = 20
  for (let i = 0; i < NUM_TEST * 100; i++) {
    if (usePickup(RATE)) {
      isTrue++
    }
  }

  // The function works with a random number, it's tested using range of error of the 30%
  t.true(isTrue / NUM_TEST > RATE * 0.70)
  t.true(isTrue / NUM_TEST < RATE * 1.30)
})

test('usePickup with rate of 80', async t => {
  let isTrue = 0
  const NUM_TEST = 100
  const RATE = 80
  for (let i = 0; i < NUM_TEST * 100; i++) {
    if (usePickup(RATE)) {
      isTrue++
    }
  }

  // The function works with a random number, it's tested using range of error of the 30%
  t.true(isTrue / NUM_TEST > RATE * 0.70)
  t.true(isTrue / NUM_TEST < RATE * 1.30)
})

test('usePickup with rate of 0', async t => {
  let isTrue = 0
  let isFalse = 0
  const NUM_TEST = 100
  const RATE = 0
  for (let i = 0; i < NUM_TEST * 100; i++) {
    if (usePickup(RATE)) {
      isTrue++
    } else {
      isFalse++
    }
  }

  t.is(isTrue, 0)
  t.is(isFalse, NUM_TEST * 100)
})

test('usePickup with rate of 100', async t => {
  let isTrue = 0
  let isFalse = 0
  const NUM_TEST = 100
  const RATE = 100
  for (let i = 0; i < NUM_TEST * 100; i++) {
    if (usePickup(RATE)) {
      isTrue++
    } else {
      isFalse++
    }
  }

  t.is(isTrue, NUM_TEST * 100)
  t.is(isFalse, 0)
})

import test from 'ava'
import usePickup from '../basic/helper/use-pickup.js'

const BALANCER_RATES = [5, 10, 20, 50, 80, 90]
const TOLERANCE = 0.3
const NUM_TEST = 100

function runManyTest (balancerRate) {
  let isTrue = 0
  let isFalse = 0

  for (let i = 0; i < NUM_TEST * 100; i++) {
    if (usePickup(balancerRate)) {
      isTrue++
    } else {
      isFalse++
    }
  }

  return { isTrue, isFalse }
}

test('usePickup with balancer rate rate of [5, 10, 20, 50, 80, 90]', async t => {
  for (const balancerRate of BALANCER_RATES) {
    const { isTrue } = runManyTest(balancerRate)

    // The function works with a random number, it's tested using range of error of the 30%
    t.true(isTrue / NUM_TEST > balancerRate * (1 - TOLERANCE))
    t.true(isTrue / NUM_TEST < balancerRate * (1 + TOLERANCE))
  }
})

test('usePickup with rate of 0', async t => {
  const { isTrue, isFalse } = runManyTest(0)

  t.is(isTrue, 0)
  t.is(isFalse, NUM_TEST * 100)
})

test('usePickup with rate of 100', async t => {
  const { isTrue, isFalse } = runManyTest(100)

  t.is(isTrue, NUM_TEST * 100)
  t.is(isFalse, 0)
})

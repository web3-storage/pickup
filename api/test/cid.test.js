import { isCID, sanitizeCid } from '../basic/helper/cid.ts'
import test from 'ava'

test('isCID', t => {
  t.is(isCID('bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354'), true)

  t.is(isCID('QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'), true)
  t.is(isCID('zQmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'), true)

  t.is(isCID('QmdnJHe9XKk6atRSqAq1SdCu12MMSKxSPC93EWngEDoypj'), true)
  t.is(isCID('zQmdnJHe9XKk6atRSqAq1SdCu12MMSKxSPC93EWngEDoypj'), true)

  t.is(isCID('QmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n'), true)
  t.is(isCID('zQmbNQYjYuKKccN8ApSNpJnoqqtyGxrBcQZ8bGeUwuXhZ5Q'), true)

  t.is(isCID('zInvalid'), false)
  t.is(isCID('zbafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354'), false)
})

test('sanitizeCid', t => {
  t.is(sanitizeCid('bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354'), 'bafybeiczsscdsbs7ffqz55asqdf3smv6klcw3gofszvwlyarci47bgf354')
  t.is(sanitizeCid('QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'), 'QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn')
  t.is(sanitizeCid('zQmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn'), 'QmUNLLsPACCz1vLxQVkXqqLX5R1X345qqfHbsf67hvA3Nn')
  t.is(sanitizeCid('QmdnJHe9XKk6atRSqAq1SdCu12MMSKxSPC93EWngEDoypj'), 'QmdnJHe9XKk6atRSqAq1SdCu12MMSKxSPC93EWngEDoypj')
  t.is(sanitizeCid('zQmdnJHe9XKk6atRSqAq1SdCu12MMSKxSPC93EWngEDoypj'), 'QmdnJHe9XKk6atRSqAq1SdCu12MMSKxSPC93EWngEDoypj')
  t.is(sanitizeCid('QmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n'), 'QmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n')
  t.is(sanitizeCid('zQmbNQYjYuKKccN8ApSNpJnoqqtyGxrBcQZ8bGeUwuXhZ5Q'), 'QmbNQYjYuKKccN8ApSNpJnoqqtyGxrBcQZ8bGeUwuXhZ5Q')
})

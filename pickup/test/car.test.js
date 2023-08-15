import { packToBlob } from 'ipfs-car/pack/blob'
import { checkCar } from '../lib/car.js'
import test from 'ava'

test('checkCar', async t => {
  const { car } = await packToBlob({ input: 'hello world', wrapWithDirectory: false })
  const { carCid, carBytes, report } = await checkCar(car.stream())
  t.is(carCid.toString(), 'bagbaierao5e6fdcp4p3iyafmbcxudqoe63qcoxegxwpivz5zirw2pulgg4ia')
  t.is(report.blocksIndexed, 1)
  t.is(report.undecodeable, 0)
  t.is(report.uniqueCids, 1)
  t.is(report.structure, 'Complete')
  t.is(carBytes, 107)
})

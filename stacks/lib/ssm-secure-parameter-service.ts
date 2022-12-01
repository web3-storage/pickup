// SDK is needed because cloudformation doesn't support secure strings
import aws from 'aws-sdk'


export class SSMSecureParameterService {
  private readonly ssm;
  constructor(region: string) {
    this.ssm = new aws.SSM({
      region,
    })
  }

  async putIfNotExists(parameterName: string, tags: Record<string, string>) {
    console.log('********** debug: Converting tags record to list')
    const tagsList = this.objMapToKeyValueList(tags)
    console.log(tagsList)
    console.log(`Creating ${parameterName} secureString type parameter`)
    const ssmPutResult = await this.ssm.putParameter({
      Name: parameterName,
      Type: 'SecureString',
      Value: 'changeMe',
      Overwrite: false, // TODO: This throws an error that must be ignored.
      // Tags: [
      //   {
      //     "Key": "aaaa",
      //     "Value": "bbbbb"
      //   }
      // ]
    }).promise()
    console.log(ssmPutResult);
  }

  //TODO: Remove param. Probably I can get when it's been deleted from the stack object?
  private objMapToKeyValueList(obj: Record<string, string>) {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [{"key": k, "value": v}]));
  }
}

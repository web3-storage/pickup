// SDK is needed because cloudformation doesn't support secure strings
import aws from 'aws-sdk'


export class SSMSecureParameterService {
  private readonly ssm;
  constructor(region: string) {
    this.ssm = new aws.SSM({
      region,
    })
  }

  putIfNotExists(parameterName: string, tags: Record<string, string>) {
    console.log(`Creating ${parameterName} secureString type parameter`)
    return this.ssm.putParameter({
      Name: parameterName,
      Type: 'SecureString',
      Value: 'changeMe',
      Overwrite: false, // TODO: Is this already enough to do nothing if already exists? No. This throws an error that must be ignored.
    }).promise()
  }

  //TODO: Remove param. Probably I can get when it's been deleted from the stack object?
}

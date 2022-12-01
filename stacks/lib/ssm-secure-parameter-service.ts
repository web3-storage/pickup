// SDK is needed because cloudformation doesn't support secure strings
import aws from 'aws-sdk'

export class SSMSecureParameterService {
  private readonly ssm
  constructor(region: string) {
    this.ssm = new aws.SSM({
      region,
    })
  }

  async putIfNotExists(parameterName: string, tagList: Array<any>) {
    const ssmPutResult = await this.ssm
      .putParameter({
        Name: parameterName,
        Type: 'SecureString',
        Value: 'changeMe',
        Overwrite: false, // TODO: This throws an error that must be ignored.
        Tags: tagList
      })
      .promise()
    console.log(ssmPutResult)
  }
}

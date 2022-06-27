import { StackContext, Api, Table, Topic } from '@serverless-stack/resources'

export function PinningServiceStack ({ stack }: StackContext): void {
  const topic = new Topic(stack, 'Pin')

  const table = new Table(stack, 'PinStatusv2', {
    fields: {
      requestid: 'string',
      userid: 'string'
    },
    primaryIndex: {
      partitionKey: 'userid',
      sortKey: 'requestid'
    }
  })

  const api = new Api(stack, 'api', {
    cors: true,
    defaults: {
      function: {
        permissions: [table, topic], // Allow the API to access the table and topic
        environment: {
          TABLE_NAME: table.tableName,
          TOPIC_ARN: topic.topicArn
        }
      }
    },
    routes: {
      'GET    /pins': 'functions/PinningService.handler',
      'POST   /pins': 'functions/PinningService.handler',
      'GET    /pins/{requestId}': 'functions/PinningService.handler',
      'POST   /pins/{requestId}': 'functions/PinningService.handler',
      'DELETE /pins/{requestId}': 'functions/PinningService.handler'
    }
    // adding a 404 default route handler means CORS OPTION not work without extra config.
  })

  // Show the endpoint in the output
  stack.addOutputs({
    ApiEndpoint: api.url,
    TopicName: topic.topicName,
    TopicARN: topic.topicArn
  })
}

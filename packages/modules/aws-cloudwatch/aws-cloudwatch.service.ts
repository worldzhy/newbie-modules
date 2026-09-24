import {Injectable} from '@nestjs/common';
import {
  CloudWatchClient,
  GetMetricDataCommand,
  GetMetricDataCommandOutput,
  ListMetricsCommand,
} from '@aws-sdk/client-cloudwatch';
import {GetEC2InstancesCPUMetricParams, GetRDSInstancesMetricParams, MetricData} from './aws-cloudwatch.interface';
import {CloudwatchEC2MetricName} from '@microservices/aws-cloudwatch/aws-cloudwatch.enum';

@Injectable()
export class AwsCloudwatchService {
  constructor() {}

  private initCloudwatchClient(args: {accessKeyId?: string; secretAccessKey?: string; region: string}) {
    const {accessKeyId, secretAccessKey, region} = args;
    let client: CloudWatchClient;
    if (accessKeyId && secretAccessKey) {
      client = new CloudWatchClient({region, credentials: {accessKeyId, secretAccessKey}});
    } else {
      client = new CloudWatchClient({region});
    }
    return client;
  }

  async getEC2InstancesMetric(params: GetEC2InstancesCPUMetricParams) {
    const {
      ec2InstanceRemoteIds,
      metricName,
      accessKeyId,
      secretAccessKey,
      region,
      startTime,
      endTime,
      period,
      statistics,
    } = params;
    const cloudwatchClient = this.initCloudwatchClient({accessKeyId, secretAccessKey, region});
    if (ec2InstanceRemoteIds.length === 0) {
      return [];
    }

    const metricQueries: any[] = [];

    if (metricName === CloudwatchEC2MetricName.CPU_UTILIZATION) {
      ec2InstanceRemoteIds.forEach(remoteId => {
        metricQueries.push({
          Metric: {
            Namespace: 'AWS/EC2',
            MetricName: metricName,
            Dimensions: [{Name: 'InstanceId', Value: remoteId}],
          },
          Period: period,
          Stat: statistics,
        });
      });
    }

    if (metricName === CloudwatchEC2MetricName.DISK_USED_PERCENT) {
      // We need to list every ec2 instance metrics as well.
      for (const remoteId of ec2InstanceRemoteIds) {
        const listMetricsCommand = new ListMetricsCommand({
          Namespace: 'CWAgent',
          MetricName: metricName,
          Dimensions: [
            {Name: 'InstanceId', Value: remoteId},
            {Name: 'path', Value: '/'},
          ],
        });
        const listRes = await cloudwatchClient.send(listMetricsCommand);
        if (listRes && listRes.Metrics && listRes.Metrics.length > 0) {
          metricQueries.push({
            Metric: {...listRes.Metrics[0]},
            Period: period,
            Stat: statistics,
          });
        }
      }
    }

    if (metricName === CloudwatchEC2MetricName.MEM_USED__PERCENT) {
      // We need to list every ec2 instance metrics as well.
      for (const remoteId of ec2InstanceRemoteIds) {
        const listMetricsCommand = new ListMetricsCommand({
          Namespace: 'CWAgent',
          MetricName: metricName,
          Dimensions: [{Name: 'InstanceId', Value: remoteId}],
        });
        const listRes = await cloudwatchClient.send(listMetricsCommand);
        if (listRes && listRes.Metrics && listRes.Metrics.length > 0) {
          metricQueries.push({
            Metric: {...listRes.Metrics[0]},
            Period: period,
            Stat: statistics,
          });
        }
      }
    }

    const command = new GetMetricDataCommand({
      StartTime: startTime,
      EndTime: endTime,
      MetricDataQueries: metricQueries.map((item, idx) => {
        let id = '';
        if (metricName === CloudwatchEC2MetricName.CPU_UTILIZATION) {
          id = `cpu${idx}`;
        } else if (metricName === CloudwatchEC2MetricName.DISK_USED_PERCENT) {
          id = `disk${idx}`;
        } else {
          id = `mem${idx}`;
        }
        return {
          Id: id,
          MetricStat: item,
          ReturnData: true,
        };
      }),
    });

    const metricData = await cloudwatchClient.send(command);
    return this.parseGetMetricDataCommandOutput(metricData);
  }

  async getRDSInstancesMetric(params: GetRDSInstancesMetricParams) {
    const {
      rdsInstanceRemoteIds,
      accessKeyId,
      secretAccessKey,
      region,
      metricName,
      startTime,
      endTime,
      period,
      statistics,
    } = params;
    const cloudwatchClient = this.initCloudwatchClient({accessKeyId, secretAccessKey, region});
    if (rdsInstanceRemoteIds.length === 0) {
      return [];
    }

    const command = new GetMetricDataCommand({
      StartTime: startTime,
      EndTime: endTime,
      MetricDataQueries: rdsInstanceRemoteIds.map((id, index) => ({
        Id: `q${index}`,
        MetricStat: {
          Metric: {
            Namespace: 'AWS/RDS',
            MetricName: metricName,
            Dimensions: [{Name: 'DBInstanceIdentifier', Value: id}],
          },
          Period: period,
          Stat: statistics,
        },
      })),
    });

    const metricData = await cloudwatchClient.send(command);
    return this.parseGetMetricDataCommandOutput(metricData);
  }

  private parseGetMetricDataCommandOutput(output: GetMetricDataCommandOutput) {
    // const results: (MetricDataResult | {DataPoints: {timestamp: Date; value: number}[]})[] = [];
    const results: MetricData[] = [];

    if (output.MetricDataResults) {
      for (const result of output.MetricDataResults) {
        const dataPoints: {timestamp: Date; value: number}[] = [];
        if (result.Timestamps && result.Values) {
          dataPoints.push(
            ...result.Timestamps.map((t, i) => ({
              timestamp: new Date(t),
              value: result.Values![i],
            }))
          );
          dataPoints.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        }

        results.push({...result, DataPoints: dataPoints});
      }
    }

    return results;
  }
}

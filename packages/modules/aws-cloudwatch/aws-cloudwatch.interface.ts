import {MetricDataResult} from '@aws-sdk/client-cloudwatch';
import {
  CloudwatchEC2MetricName,
  CloudwatchMetricRDSMetricName,
  CloudwatchMetricStatistics,
} from './aws-cloudwatch.enum';

export interface GetEC2InstancesCPUMetricParams {
  ec2InstanceRemoteIds: string[];
  metricName: CloudwatchEC2MetricName;
  region: string;
  startTime: Date;
  endTime: Date;
  period: number;
  statistics: CloudwatchMetricStatistics;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface GetRDSInstancesMetricParams {
  rdsInstanceRemoteIds: string[];
  metricName: CloudwatchMetricRDSMetricName;
  region: string;
  startTime: Date;
  endTime: Date;
  period: number;
  statistics: CloudwatchMetricStatistics;
  accessKeyId?: string;
  secretAccessKey?: string;
}

export interface MetricData extends MetricDataResult {
  DataPoints: {timestamp: Date; value: number}[];
}

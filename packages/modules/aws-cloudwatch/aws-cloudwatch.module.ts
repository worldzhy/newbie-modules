import {Global, Module} from '@nestjs/common';
import {ClickhouseModule} from '@microservices/clickhouse/clickhouse.module';
import {AwsCloudwatchService} from '@microservices/aws-cloudwatch/aws-cloudwatch.service';
import {AWSAccountController} from '@microservices/aws-cloudwatch/aws-account/aws-account.controller';
import {Ec2InstanceController} from './ec2-instance/ec2-instance.controller';
import {Ec2InstanceService} from './ec2-instance/ec2-instance.service';
import {Ec2MetricController} from './ec2-instance/ec2-metric.controller';
import {Ec2MetricService} from './ec2-instance/ec2-metric.service';
import {RdsInstanceController} from './rds-instance/rds-instance.controller';
import {RdsInstanceService} from './rds-instance/rds-instance.service';
import {RdsMetricController} from './rds-instance/rds-metric.controller';
import {RdsMetricService} from './rds-instance/rds-metric.service';
import {BackendMonitorController} from './backend-monitor/backend-monitor.controller';
import {BackendMonitorService} from './backend-monitor/backend-monitor.service';
import {AiAnalysisController} from './ai-analysis/ai-analysis.controller';
import {AiAnalysisService} from './ai-analysis/ai-analysis.service';

@Global()
@Module({
  imports: [ClickhouseModule],
  controllers: [
    AWSAccountController,
    Ec2InstanceController,
    Ec2MetricController,
    RdsInstanceController,
    RdsMetricController,
    BackendMonitorController,
    AiAnalysisController,
  ],
  providers: [
    AwsCloudwatchService,
    Ec2InstanceService,
    Ec2MetricService,
    RdsInstanceService,
    RdsMetricService,
    BackendMonitorService,
    AiAnalysisService,
  ],
  exports: [
    AwsCloudwatchService,
    Ec2InstanceService,
    Ec2MetricService,
    RdsInstanceService,
    RdsMetricService,
    BackendMonitorService,
    AiAnalysisService,
  ],
})
export class AwsCloudwatchModule {}

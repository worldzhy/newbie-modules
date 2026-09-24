export enum CloudwatchMetricStatistics {
  AVERAGE = 'Average',
  MINIMUM = 'Minimum',
  MAXIMUM = 'Maximum',
}

export enum CloudwatchEC2MetricName {
  CPU_UTILIZATION = 'CPUUtilization',
  DISK_USED_PERCENT = 'disk_used_percent',
  MEM_USED__PERCENT = 'mem_used_percent',
}

export enum CloudwatchMetricRDSMetricName {
  CPU_UTILIZATION = 'CPUUtilization',
  DATABASE_CONNECTIONS = 'DatabaseConnections',
}

export enum AWSRegion {
  US_EAST_1 = 'us_east_1',
  US_EAST_2 = 'us_east_2',
  CN_NORTH_1 = 'cn_north_1',
  CN_NORTHWEST_1 = 'cn_northwest_1',
}

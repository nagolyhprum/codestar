import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const NextJSBucket = new s3.Bucket(this, "NextJSBucket", {})

    const NextJSLogGroup = new logs.LogGroup(this, "NextJSLogGroup", {})

    const NextJSProject = new codebuild.Project(this, "NextJSProject", {      
      artifacts: codebuild.Artifacts.s3({
        bucket : NextJSBucket,
        packageZip: true,
        includeBuildId : false,        
      }),
      concurrentBuildLimit : 1,
      source: codebuild.Source.gitHub({
        owner : "nagolyhprum",
        repo : "codestar",
        branchOrRef : "main",     
        webhook: true,
        webhookTriggersBatchBuild: true,
        webhookFilters: [
          codebuild.FilterGroup
            .inEventOf(codebuild.EventAction.PUSH)
            .andBranchIs('main')
        ],
      }),
      logging : {
        cloudWatch : {
          enabled : true,
          logGroup: NextJSLogGroup
        }
      },      
      environment : {        
        buildImage : codebuild.LinuxBuildImage.STANDARD_6_0,
        privileged : true
      },      
    })

    const NextJSVpc = new ec2.Vpc(this, "NextJSVpc")

    const NextJSAutoScalingGroup = new autoscaling.AutoScalingGroup(this, "NextJSAutoScalingGroup", {
      vpc : NextJSVpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE2, ec2.InstanceSize.NANO),
      machineImage: new ec2.AmazonLinuxImage(),
    })

    const NextJSApplication = new codedeploy.ServerApplication(this, "NextJSApplication", {})

    const NextJSDeploymentGroup = new codedeploy.ServerDeploymentGroup(this, "NextJSDeploymentGroup", {
      application : NextJSApplication,   
      autoScalingGroups : [NextJSAutoScalingGroup],
    })
  }
}

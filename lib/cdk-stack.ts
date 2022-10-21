import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { CodeDeployServerDeployAction, S3SourceAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';

const REGION = "us-east-1"
const BUCKET_NAME = `aws-codedeploy-${REGION}`;

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const NextJSBucket = new s3.Bucket(this, "NextJSBucket", {
      versioned : true
    })

    const NextJSLogGroup = new logs.LogGroup(this, "NextJSLogGroup", {})

    const NextJSProject = new codebuild.Project(this, "NextJSProject", {      
      badge : true,
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
        webhookTriggersBatchBuild: false,                
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
        privileged : true,        
      },      
    })

    const NextJSVpc = new ec2.Vpc(this, "NextJSVpc", {})

    const NextJSSecurityGroup = new ec2.SecurityGroup(this, "NextJSSecurityGroup", {
      vpc : NextJSVpc,            
      allowAllOutbound : true,      
    })
    
    NextJSSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.allTraffic(), "In")
    // NextJSSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.allTraffic(), "Out")

    const NextJSInstance = new ec2.Instance(this, "NextJSInstance", {
      vpc : NextJSVpc,
      instanceType: new ec2.InstanceType("t3.nano"),
      machineImage: new ec2.AmazonLinuxImage(),
      securityGroup : NextJSSecurityGroup,      
      keyName : "NextJS",      
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },      
      // https://docs.aws.amazon.com/codedeploy/latest/userguide/codedeploy-agent-operations-install-linux.html
      // sudo yum install ruby
      // sudo yum install wget
      // cd /home/ec2-user
      // wget https://aws-codedeploy-us-east-1.s3.us-east-1.amazonaws.com/latest/install
      // chmod +x ./install
      // sudo ./install auto
    })
    cdk.Tags.of(NextJSInstance).add('version', '1.0.0');
    const NextJSEIP = new ec2.CfnEIP(this, "NextJSEIP", {
      instanceId : NextJSInstance.instanceId,                  
    })

    const NextJSAutoScalingGroup = new autoscaling.AutoScalingGroup(this, "NextJSAutoScalingGroup", {
      vpc : NextJSVpc,
      instanceType: new ec2.InstanceType("t3.nano"),
      machineImage: new ec2.AmazonLinuxImage(),
      securityGroup : NextJSSecurityGroup,      
      keyName : "NextJS",      
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },          
      associatePublicIpAddress:true,        
    })

    const NextJSApplication = new codedeploy.ServerApplication(this, "NextJSApplication", {})

    const NextJSDeploymentGroup = new codedeploy.ServerDeploymentGroup(this, "NextJSDeploymentGroup", {
      application : NextJSApplication,   
      ec2InstanceTags : new codedeploy.InstanceTagSet({
        "version" : ["1.0.0"]
      }),
      autoScalingGroups : [NextJSAutoScalingGroup],
    })

    const NextJSPipeline = new codepipeline.Pipeline(this, "NextJSPipeline", {
      stages : [{
        stageName : "Source",
        actions : [
          new S3SourceAction({
            actionName : "Source",
            bucket : NextJSBucket,
            bucketKey : NextJSProject.projectName,
            output : new codepipeline.Artifact("Source"),            
          })
        ]
      }, {
        stageName : "Deploy",
        actions : [
          new CodeDeployServerDeployAction({
            actionName : "Deploy",
            deploymentGroup : NextJSDeploymentGroup,
            input : new codepipeline.Artifact("Source"),                                  
          })
        ]
      }]
    })
    NextJSPipeline.artifactBucket.grantReadWrite(NextJSInstance)    
    NextJSPipeline.artifactBucket.grantReadWrite(NextJSAutoScalingGroup)    
  }
}

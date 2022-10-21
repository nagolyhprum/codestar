import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as codedeploy from 'aws-cdk-lib/aws-codedeploy';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { CodeDeployServerDeployAction, S3SourceAction } from 'aws-cdk-lib/aws-codepipeline-actions';
import { HttpVersion } from 'aws-cdk-lib/aws-cloudfront';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';

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

    const NextJSVpc = new ec2.Vpc(this, "NextJSVpc", {natGateways: 1})

    const NextJSSecurityGroup = new ec2.SecurityGroup(this, "NextJSSecurityGroup", {
      vpc : NextJSVpc,    
    })
    
    NextJSSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.allTraffic(), "In")

    const NextJSAutoScalingGroup = new autoscaling.AutoScalingGroup(this, "NextJSAutoScalingGroup", {
      vpc : NextJSVpc,
      instanceType: new ec2.InstanceType("t3.nano"),
      machineImage: new ec2.AmazonLinuxImage(),
      securityGroup : NextJSSecurityGroup,      
      keyName : "NextJS",                
    })

    // https://bobbyhadz.com/blog/aws-cdk-application-load-balancer
    const NextJSLoadBalancer = new elbv2.ApplicationLoadBalancer(this, 'NextJSLoadBalancer', {
      vpc: NextJSVpc,
      internetFacing: true,
    });

    const listener = NextJSLoadBalancer.addListener('Listener', {
      port: 80,
      open: true,
    });

    listener.addTargets('default-target', {
      port: 80,
      targets: [NextJSAutoScalingGroup],
    });

    const NextJSApplication = new codedeploy.ServerApplication(this, "NextJSApplication", {})

    const NextJSDeploymentGroup = new codedeploy.ServerDeploymentGroup(this, "NextJSDeploymentGroup", {
      application : NextJSApplication,   
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
    NextJSPipeline.artifactBucket.grantReadWrite(NextJSAutoScalingGroup) 
    
    // loganmurphy.us, *.loganmurphy.us
    const NextJSCertificate = Certificate.fromCertificateArn(this, "NextJSCertificate", "arn:aws:acm:us-east-1:796357290755:certificate/e84949cd-9346-4643-a664-98fb4e981766")

    const NextJSCloudFront = new cloudfront.CloudFrontWebDistribution(this, "NextJSCloudFront", {      
      defaultRootObject : "",
      originConfigs : [{
        behaviors : [{
          // compress : true,
          // cachedMethods : cloudfront.CloudFrontAllowedCachedMethods.GET_HEAD,
          allowedMethods : cloudfront.CloudFrontAllowedMethods.ALL,
          // viewerProtocolPolicy : cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          isDefaultBehavior : true,          
        }],      
        customOriginSource : {
          originProtocolPolicy : cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          domainName : NextJSLoadBalancer.loadBalancerDnsName,                              
          // originShieldRegion : "us-east-1",
        },                
        // originShieldRegion : "us-east-1",        
      }],            
      enableIpV6 : true,
      httpVersion : HttpVersion.HTTP2,    
      priceClass : cloudfront.PriceClass.PRICE_CLASS_ALL,
      viewerCertificate : cloudfront.ViewerCertificate.fromAcmCertificate(NextJSCertificate, {
        aliases : ["next.loganmurphy.us"]
      }),
      viewerProtocolPolicy : cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,      
    })

    // loganmurphy.us
		const NextJSHostedZone = route53.HostedZone.fromHostedZoneAttributes(this, "NextJSHostedZone", {
			hostedZoneId : "Z03134683QY493S0RMPB0",
			zoneName : "loganmurphy.us",
		});
    
		const NextJSRecord = new route53.ARecord(this, "NextJSRecord", {
			recordName : "next.loganmurphy.us",
			target : route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(NextJSCloudFront)),
			zone : NextJSHostedZone,
		});
  }
}

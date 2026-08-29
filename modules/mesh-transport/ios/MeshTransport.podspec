require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'MeshTransport'
  s.version        = package['version']
  s.summary        = package['description']
  s.license        = package['license'] || { :type => 'MIT' }
  s.homepage       = 'https://github.com/hypercolor-app/hypercolor'
  s.authors        = { 'Hypercolor' => 'dev@hypercolor.app' }
  s.platforms      = { :ios => '15.0' }
  s.source         = { :git => '' }

  s.source_files   = '**/*.swift'

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'SWIFT_VERSION' => '5.9',
    # CoreBluetooth is a system framework — no download needed.
  }

  s.frameworks = ['CoreBluetooth']
end

# Mac / Windows 多设备接入测试

本指南对应当前已实现的 Campus Compute，不需要队员编写业务代码。主机在2026-09-11检查到的局域网地址是 **http://172.26.16.11:3000**，协调服务已配置为监听0.0.0.0:3000。网络切换后IP可能改变；先验证地址再下载/安装其他内容。当前只从主机验证过LAN地址响应，其他物理设备是否互通仍需现场确认。

## 1. 所有设备先做的网络检查

让队友连接与主机可互通的网络，用浏览器打开 http://172.26.16.11:3000 。看见加入码页面或平台页面，说明第一步成功。

- 加入码从主机私有 `config/local-server.json` 的 `joinCode` 字段取得，单独给受信任的队友；客户端包不包含它。
- 队友的 `coordinatorUrl` 必须填主机LAN地址。队友填写127.0.0.1会连接到自己的电脑。
- 看仪表盘可以打开主机地址；控制自己的贡献必须打开自己电脑的 http://127.0.0.1:3001 。
- 不要在队友电脑执行 `npm run server`；全队只启动一个协调服务。
- 同一Wi-Fi不一定允许设备互访。若打不开，先检查主机IP、主机应用防火墙是否允许Node的入站连接、网络是否隔离客户端；必要时更换允许互访的路由器/热点并重新检查地址。无需关闭整个防火墙或做公网端口转发。

## 2. 传给队友的文件

发送 `output/device-kit/campus-compute-client.zip`，解压到本机普通目录，例如 Mac `~/CampusComputeClient` 或 Windows `C:\CampusComputeClient`。

另发送模型 `qwen2.5-1.5b-instruct-q4_k_m.gguf`（约1.12GB），所有设备使用同一份模型。主机现成文件在：

```
~/Library/Application Support/CampusCompute/models/qwen2.5-1.5b-instruct-q4_k_m.gguf
```

也可从[固定Qwen官方revision](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/blob/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf)下载。不要换量化版本或修改文件名。

安装[Node.js24.21.0官方版本](https://nodejs.org/en/download/archive/v24.21.0)：Mac使用pkg安装包；下面Windows步骤按Intel/AMD x64电脑，使用x64.msi。安装后重新打开终端，`node --version`应显示v24.21.0。

客户端包包含代码、构建好的网页、固定数据、公共运行清单和配置模板；不包含node_modules、模型、引擎、主机数据库或密码。每台电脑各自执行一次依赖安装，需要网络。

## 3. M系列Mac

准备未同步的本机目录：

```
~/Library/Application Support/CampusCompute/
  models/qwen2.5-1.5b-instruct-q4_k_m.gguf
  engine/llama-b10917/llama-server
  worker/                         # 自动创建
```

引擎可以直接复制主机的完整 `engine/llama-b10917` 文件夹，或使用[官方b10917 macOS arm64发行包](https://github.com/ggml-org/llama.cpp/releases/download/b10917/llama-b10917-bin-macos-arm64.tar.gz)。必须保留旁边全部dylib和其他发行文件。

在解压后的客户端目录打开终端：

```sh
node --version
npm ci
cp config/worker.mac.example.json config/local-worker.json
cp config/probe.mac.example.json config/local-probe.json
```

编辑这两个JSON：

- 将路径中的 `YOUR_USERNAME` 换成这台Mac的用户名，并核实模型和引擎确实在指定位置。JSON里的路径不会自动展开`~`。
- `name` 改成易辨认的设备名，例如 `alice-mac`。
- Worker配置中的 `joinCode` 换成主机加入码；核对 `coordinatorUrl`。
- 保持 `backend: "metal"`。每台电脑的8081/3001端口可以相同，因为它们只在各自本机使用。

先执行真实20题探针，确认依赖、模型、运行指纹和Metal后端：

```sh
npm run probe -- --config config/local-probe.json --lock config/runtime.lock.json --output docs/validation/probe-this-device.json
```

探针成功后再启动贡献客户端：

```sh
npm run worker -- --config config/local-worker.json
```

打开自己电脑的 http://127.0.0.1:3001 ，第一次接入先选Low，点击Start / Resume。加载完成后主机仪表盘应看到 `alice-mac`。不要同时运行探针和Worker；它们使用同一本机端口。

## 4. Windows x64

两条路线任选其一：

| 设备 | backend | 引擎 |
|---|---|---|
| Intel/AMD处理器；无NVIDIA显卡或先验证连接 | cpu | [b10917 Windows x64 CPU包](https://github.com/ggml-org/llama.cpp/releases/download/b10917/llama-b10917-bin-win-cpu-x64.zip) |
| 有兼容NVIDIA显卡及驱动，要用GPU | cuda | [b10917 CUDA12.4 x64包](https://github.com/ggml-org/llama.cpp/releases/download/b10917/llama-b10917-bin-win-cuda-12.4-x64.zip)及[同版本CUDA12.4 DLL包](https://github.com/ggml-org/llama.cpp/releases/download/b10917/cudart-llama-bin-win-cuda-12.4-x64.zip) |

[官方发行页](https://github.com/ggml-org/llama.cpp/releases/tag/b10917)列出这些对应构建。CUDA是否能运行以这台电脑的驱动和真实探针为准；当前项目尚无Windows真机通过记录。AMD/Intel显卡不能选CUDA。此指南不把未测试的Vulkan/OpenCL构建当作已支持后端。

推荐目录：

```
C:\CampusCompute\models\qwen2.5-1.5b-instruct-q4_k_m.gguf
C:\CampusCompute\engine\llama-server.exe        # CPU，包含旁边DLL
C:\CampusCompute\engine-cuda\llama-server.exe   # CUDA，包含旁边DLL及所需CUDA DLL
C:\CampusCompute\worker\                     # 自动创建
```

解压官方引擎，确认配置指向真实 `llama-server.exe` 位置；若压缩包多嵌套一层文件夹，修改配置路径，或把完整内层目录一起放到上述位置。不要只复制exe。模型和运行目录不要放在OneDrive同步位置。

在客户端目录打开PowerShell。CPU路线：

```powershell
node --version
npm.cmd ci
Copy-Item config/worker.windows-cpu.example.json config/local-worker.json
Copy-Item config/probe.windows-cpu.example.json config/local-probe.json
```

CUDA路线将上面两个 `windows-cpu` 换成 `windows-cuda`。编辑配置，填写主机加入码、LAN地址、独立设备名如 `bob-windows`，核对模型/引擎/状态目录。模板使用 `C:/...` 路径，JSON中可直接使用。

运行探针：

```powershell
npm.cmd run probe -- --config config/local-probe.json --lock config/runtime.lock.json --output docs/validation/probe-this-device.json
```

成功后启动：

```powershell
npm.cmd run worker -- --config config/local-worker.json
```

然后在这台Windows电脑打开 http://127.0.0.1:3001 ，先选择Low并点击Start / Resume。它只会在引擎验证和预热成功后注册到主机。

## 5. 运行清单与首次跨平台核对

每台设备保留 `docs/validation/probe-this-device.json`。探针会核对现有 `config/runtime.lock.json`，在模型/模板/引擎版本的语义指纹相同时添加新平台的真实二进制记录。

Mac复制相同官方引擎通常无需改变已有Mac构件记录。首台Windows完成探针后，将其探针报告和更新后的 `config/runtime.lock.json` 交回主机保存。若多种新后端并行测试，应合并artifacts，保留每个平台的记录；不要用较旧的清单覆盖较新的清单。合并后在下一轮评测前分发清单并重启协调服务和已停止的Worker，使新报告记录完整清单。Windows的加入本身仍以匹配的inferenceKey验证，不能伪造哈希通过检查。

首次测试优先一台接一台完成探针和接入。若探针报指纹不一致，保留错误和报告，核查固定包；不要手改哈希。

## 6. 真正的双机功能测试

1. 两台设备均打开各自贡献页，完成模型加载，主机看到两个不同设备名为Ready。建议都选Low，给人工操作留出时间。
2. 主机发布200题×3提示词的新评测。在三个Instruction末尾追加一次尚未使用的实际指令，例如 `Review every choice and choose the best supported answer.`。点击Preview workload，确认Fresh to run600、Reusable cache0再发布。仅改评测名称不会避开缓存。
3. 确认两个设备的Accepted work都增长。任务分配不要求50/50；更快或档位更高的设备可能完成更多。
4. 在第二台设备自己的贡献页点击Exit now。主机应显示其停止；第一台继续完成队列。若退出时正在推理，未完成题应重新入队。
5. 第二台点击Start / Resume，再次接入并领取剩余任务。退出/重进可能产生新的节点会话记录，旧行显示Stopped，不能把历史行当成额外物理电脑。
6. 完成后核对总结果600、执行失败0、普通新计算总积分600。每台测试结束都点Exit now；关闭浏览器不会停止原生Worker。

这轮只验证多机协作和进退机制。要报告加速倍率，应另用[固定对照基准流程](validation/benchmark-method.md)，避免缓存、不同档位、下载/加载时间和人为退出混进速度比较。

首次Mac接入：文件齐全后可预留10–20分钟操作；Windows尤其CUDA可能需要额外排查驱动/DLL。这个时间是操作预估，不是真机已完成的测量。

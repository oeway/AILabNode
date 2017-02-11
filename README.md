# Node.js Toolkits for AILab platform (WIP)

# Installation


```bash
git clone https://github.com/oeway/AILabNode.git
cd AILabNode

# skip the following command if have node.js installed, gcc/4.9 is required
sh install_node.sh

npm install
```

# Getting Start
You need to login to AILab.AI platform and then goto "Widget Workers", create a new worker, and get the id and token.

As an example, we get a worker `id=iJX99fYEdfasigEAd` and `token=jguogvqlerkygcc`. You need to edit the corresponding values `worker_id` and `worker_token` in the file named `index.js`.

Then, to run the actual worker, you can open a terminal window and type the following commands:
```bash
# start worker
node index.js
```

And you will see the worker running on the platform, now you are ready to go, try to create a widget and add the worker you just created. In the "Code" tab in a widget editor, you can add one code file named "worker.js" with the type "javascript" which will perform the actuall task on the worker node.

```js
const cmd = 'python';
const args = ['-c', 'print("hello world")'];

const process = $ctrl.child_process.spawn(cmd, args, {cwd:$ctrl.task.workdir});
process.stdout.on('data', (data)=>{
  console.log(data.toString());
  // parse the console output here
  $ctrl.task.set({'status.info': data.toString()});
});

$ctrl.task.init(process);
```

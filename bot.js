import ethers from "ethers";
import express from "express";
import chalk from "chalk";
import dotenv from "dotenv";
import inquirer from "inquirer";
import figlet from "figlet";
import ora from "ora";

dotenv.config();

const PORT = 5000;
const app = express();



console.clear();

// Pretty and big text
figlet("Pavlichenko Bot", (err, data) => {
  if (err) {
    console.log("Something went wrong...");
    console.dir(err);
    return;
  }
  console.log(data);
});


// Load our configs and set stuff
console.log(chalk.green("Loading configs..."));

const data = {
  WBNB: process.env.WBNB_CONTRACT, //wbnb
  to_PURCHASE: process.env.TO_PURCHASE, // token that you will purchase = BUSD for test '0xe9e7cea3dedca5984780bafc599bd69add087d56'
  AMOUNT_OF_WBNB: process.env.AMOUNT_OF_WBNB, // how much you want to buy in WBNB
  factory: process.env.FACTORY, //PancakeSwap V2 factory
  router: process.env.ROUTER, //PancakeSwap V2 router
  recipient: process.env.YOUR_ADDRESS, //your wallet address,
  Slippage: process.env.SLIPPAGE, //in Percentage
  gasPrice: process.env.GWEI, //in gwei
  gasLimit: process.env.GAS_LIMIT, //at least 21000
  minBnb: process.env.MIN_LIQUIDITY_ADDED, //min liquidity added
};


let initialLiquidityDetected = false;
let jmlBnb = 0;


const bscMainnetUrl = "https://bsc-dataseed1.defibit.io/"; //https://bsc-dataseed1.defibit.io/ https://bsc-dataseed.binance.org/
const wss = "wss://bsc-ws-node.nariox.org:443";
const mnemonic = process.env.YOUR_MNEMONIC; //your memonic;
const tokenIn = data.WBNB;
const tokenOut = data.to_PURCHASE;

// const provider = new ethers.providers.JsonRpcProvider(bscMainnetUrl)
const provider = new ethers.providers.WebSocketProvider(wss);
const wallet = new ethers.Wallet(mnemonic);
const account = wallet.connect(provider);

console.log(chalk.green.inverse("Loading complete!"));


const factory = new ethers.Contract(
  data.factory,
  [
    "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
    "function getPair(address tokenA, address tokenB) external view returns (address pair)",
  ],
  account
);

const router = new ethers.Contract(
  data.router,
  [
    "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)",
    "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  ],
  account
);

const erc = new ethers.Contract(
  data.WBNB,
  [
    {
      constant: true,
      inputs: [{ name: "_owner", type: "address" }],
      name: "balanceOf",
      outputs: [{ name: "balance", type: "uint256" }],
      payable: false,
      type: "function",
    },
  ],
  account
);


const pairAddressx = await factory.getPair(tokenIn, tokenOut);
console.log(chalk.blue(`pairAddress: ${pairAddressx}`));
const spinner = ora("Waiting for liquidity");



async function checkLiq() {
  if (pairAddressx !== null && pairAddressx !== undefined) {
    // console.log("pairAddress.toString().indexOf('0x0000000000000')", pairAddress.toString().indexOf('0x0000000000000'));
    if (pairAddressx.toString().indexOf("0x0000000000000") > -1) {
      console.log(
        chalk.red(`pairAddress ${pairAddressx} not detected. Auto restart`)
      );
      return await run();
    }
  }
  const pairBNBvalue = await erc.balanceOf(pairAddressx);
  jmlBnb = ethers.utils.formatEther(pairBNBvalue);
  //console.log(`value BNB : ${jmlBnb}`);

  if (jmlBnb > data.minBnb) {
    setTimeout(() => buyAction(), 3000);
  } else {
    initialLiquidityDetected = false;
    spinner.start();
    return await checkLiq();
  }
};



async function buyAction() {

  if (initialLiquidityDetected === true) {
    console.log("Won't buy because already bought");
    return null;
  }

  console.log("Ready to buy");
  try {
    initialLiquidityDetected = true;
    //We buy x amount of the new token for our wbnb
    const amountIn = ethers.utils.parseUnits(`${data.AMOUNT_OF_WBNB}`, "ether");
    const amounts = await router.getAmountsOut(amountIn, [tokenIn, tokenOut]);

    //Our execution price will be a bit different, we need some flexbility
    const amountOutMin = amounts[1].sub(amounts[1].div(`${data.Slippage}`));

    console.log(
      chalk.green.inverse(`Start to buy \n`) +
        `Buying Token
        =================
        tokenIn: ${amountIn.toString()} ${tokenIn} (WBNB)
        tokenOut: ${amountOutMin.toString()} ${tokenOut}
      `
    );

    console.log("Processing Transaction.....");
    console.log(chalk.yellow(`amountIn: ${amountIn}`));
    console.log(chalk.yellow(`amountOutMin: ${amountOutMin}`));
    console.log(chalk.yellow(`tokenIn: ${tokenIn}`));
    console.log(chalk.yellow(`tokenOut: ${tokenOut}`));
    console.log(chalk.yellow(`data.recipient: ${data.recipient}`));
    console.log(chalk.yellow(`data.gasLimit: ${data.gasLimit}`));
    console.log(chalk.yellow(
      `data.gasPrice: ${ethers.utils.parseUnits(`${data.gasPrice}`, "gwei")}`
    ));

    const tx = await router.swapExactTokensForTokens(
      amountIn,
      amountOutMin,
      [tokenIn, tokenOut],
      data.recipient,
      Date.now() + 1000 * 60 * 5, // 5 minutes
      {
        gasLimit: data.gasLimit,
        gasPrice: ethers.utils.parseUnits(`${data.gasPrice}`, "gwei"),
        nonce: null, // Set you want buy at where position in blocks
      }
    );

    const receipt = await tx.wait();
    console.log(
      `Transaction receipt : https://www.bscscan.com/tx/${receipt.logs[1].transactionHash}`
    );
    return receipt;
  } catch (err) {
    let error = JSON.parse(JSON.stringify(err));
    console.log(`Error caused by :
        {
        reason : ${error.reason},
        transactionHash : ${error.transactionHash}
        message : Please check your BNB/WBNB balance, maybe its due because insufficient balance or approve your token manually on pancakeSwap
        }`);
    console.log(error);

    inquirer
      .prompt([
        {
          type: "confirm",
          name: "runAgain",
          message: "Do you want to run again this bot?",
        },
      ])
      .then((answers) => {
        if (answers.runAgain === true) {
          console.log(
            "= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = ="
          );
          console.log("Run again");
          console.log(
            "= = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = = ="
          );
          initialLiquidityDetected = false;
          run();
        } else {
          process.exit();
        }
      });
  }
};



async function run () {
  await checkLiq();
};


app.listen(PORT, () =>
  console.log(chalk.yellow(`Listening for Liquidity Addition to token ${data.to_PURCHASE}`))
);

run();
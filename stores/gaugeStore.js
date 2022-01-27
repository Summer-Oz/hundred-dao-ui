import async from 'async';
import {
  MAX_UINT256,
  ERROR,
  TX_SUBMITTED,
  STORE_UPDATED,
  CONFIGURE_GAUGES,
  GAUGES_CONFIGURED,
  GET_PROJECTS,
  PROJECTS_RETURNED,
  GET_PROJECT,
  PROJECT_RETURNED,
  GET_TOKEN_BALANCES,
  TOKEN_BALANCES_RETURNED,
  LOCK,
  LOCK_RETURNED,
  APPROVE_LOCK,
  APPROVE_LOCK_RETURNED,
  VOTE,
  VOTE_RETURNED,
  INCREASE_LOCK_AMOUNT,
  INCREASE_LOCK_AMOUNT_RETURNED,
  INCREASE_LOCK_DURATION,
  INCREASE_LOCK_DURATION_RETURNED, WITHDRAW, WITHDRAW_RETURNED, APPLY_BOOST, APPLY_BOOST_RETURNED,
} from './constants';

import { ERC20_ABI, GAUGE_CONTROLLER_ABI, GAUGE_ABI, VOTING_ESCROW_ABI, LP_ABI } from './abis';

import stores from './';
import BigNumber from 'bignumber.js';
import { PRICE_ORACLE_ABI } from './abis/HundredFinancePriceOracleABI';
import { CTOKEN_ABI } from './abis/CtokenABI';
import { REWARD_POLICY_MAKER_ABI } from './abis/RewardPolicyMaker';

const fetch = require('node-fetch');

const WEEK = 604800;
const DAY = 86400;

const currentEpochTime = () => Math.floor(new Date().getTime() / 1000)
const nextEpochTime = () => Math.floor(currentEpochTime() / WEEK) * WEEK + WEEK + DAY

class Store {
  constructor(dispatcher, emitter) {
    this.dispatcher = dispatcher;
    this.emitter = emitter;

    this.store = {
      configured: false,
      projects: [
        {
          type: 'minmaxfinance',
          id: 'minmax-finance-iotex',
          name: 'Iotex',
          logo: '/arbitrum.png',
          url: '',
          chainId: 4689,
          gaugeProxyAddress: "0xb39dF3318D42b36D1E1D65DD091A6490745a13aD",
          lpPriceOracle: "",
          rewardPolicyMaker: "0xf7414fe50b7CC4dB96592a1460EE3BA258343B8A",
          gauges: [],
          vaults: [],
          tokenMetadata: {},
          veTokenMetadata: {},
          otherTokenMetadata: {},
          useDays: false,
          maxDurationYears: 4,
          onload: null
        },
        
      ],
    };

    dispatcher.register(
      function (payload) {
        switch (payload.type) {
          case CONFIGURE_GAUGES:
            this.configure(payload);
            break;
          case GET_PROJECTS:
            this.getProjects(payload);
            break;
          case GET_PROJECT:
            this.getProject(payload);
            break;
          case GET_TOKEN_BALANCES:
            this.getTokenBalances(payload);
            break;
          case LOCK:
            this.lock(payload);
            break;
          case WITHDRAW:
            this.unlock(payload);
            break;
          case APPROVE_LOCK:
            this.approveLock(payload);
            break;
          case VOTE:
            this.vote(payload);
            break;
          case INCREASE_LOCK_AMOUNT:
            this.increaseLockAmount(payload);
            break;
          case INCREASE_LOCK_DURATION:
            this.increaseLockDuration(payload);
            break;
          case APPLY_BOOST:
            this.applyBoost(payload);
            break;
          default: {
          }
        }
      }.bind(this),
    );
  }

  getStore = (index) => {
    return this.store[index];
  };

  setStore = (obj) => {
    this.store = { ...this.store, ...obj };
    console.log(this.store);
    return this.emitter.emit(STORE_UPDATED);
  };

  configure = async (payload) => {
    const projects = this.getStore('projects');

    const web3 = await stores.accountStore.getWeb3Provider();
    let chainId = await web3?.eth?.getChainId();

    async.map(
      projects.filter(p => p.chainId === chainId),
      (project, callback) => {
        this._getProjectData(project, callback);
      },
      (err, data) => {
        if (err) {
          this.emitter.emit(ERROR);
          return;
        }
        console.log("projects", data)
        this.setStore({ projects: data, configured: true });

        this.emitter.emit(GAUGES_CONFIGURED);
      },
    );
  };

  _getProjectData = async (project, callback) => {

    const web3 = await stores.accountStore.getWeb3Provider();
    if (!web3) {
      return;
    }

    const maxPrice = await this._getMaxPrice();

    const gaugeControllerContract = new web3.eth.Contract(GAUGE_CONTROLLER_ABI, project.gaugeProxyAddress);
    //const priceOracleContract = new web3.eth.Contract(PRICE_ORACLE_ABI, project.lpPriceOracle);

    // get how many gauges there are
    const n_gauges = await gaugeControllerContract.methods.n_gauges().call();
    const tmpArr = [...Array(parseInt(n_gauges)).keys()];

    // get all the gauges
    const gaugesPromises = tmpArr.map((gauge, idx) => {
      return new Promise((resolve, reject) => {
        resolve(gaugeControllerContract.methods.gauges(idx).call());
      });
    });

    const gauges = await Promise.all(gaugesPromises);

    // get the gauge relative weights
    const gaugesWeightsPromise = gauges.map((gauge) => {
      return new Promise((resolve, reject) => {
        resolve(gaugeControllerContract.methods.get_gauge_weight(gauge).call());
      });
    });

    const gaugesWeights = await Promise.all(gaugesWeightsPromise);

    // get the gauge relative weights
    const gaugesNextEpochRelativeWeightsPromise = gauges.map((gauge) => {
      return new Promise((resolve, reject) => {
        resolve(gaugeControllerContract.methods.gauge_relative_weight(gauge, nextEpochTime()).call());
      });
    });

    const gaugesCurrentEpochRelativeWeightsPromise = gauges.map((gauge) => {
      return new Promise((resolve, reject) => {
        resolve(gaugeControllerContract.methods.gauge_relative_weight(gauge, currentEpochTime()).call());
      });
    });

    const gaugesCurrentEpochRelativeWeights = await Promise.all(gaugesCurrentEpochRelativeWeightsPromise);
    const gaugesNextEpochRelativeWeights = await Promise.all(gaugesNextEpochRelativeWeightsPromise);

    // get the gauge lp token
    const gaugesLPTokensPromise = gauges.map((gauge) => {
      return new Promise((resolve, reject) => {
        const gaugeContract = new web3.eth.Contract(GAUGE_ABI, gauge);

        resolve(gaugeContract.methods.lp_token().call());
      });
    });

    const gaugesLPTokens = await Promise.all(gaugesLPTokensPromise);
    
    // get LP token info
    const lpTokensPromise = gaugesLPTokens
      .map((lpToken, index) => {
        const lpTokenContract = new web3.eth.Contract(ERC20_ABI, lpToken);
        //const lpUnderlyingTokenContract = new web3.eth.Contract(ERC20_ABI, lpTokenUnderlyingInfo[index * 3 + 2]);

        const promises = [];
        const namePromise = new Promise((resolve, reject) => {
          resolve(lpTokenContract.methods.name().call());
        });
        const symbolPromise = new Promise((resolve, reject) => {
          resolve(lpTokenContract.methods.symbol().call());
        });
        const decimalsPromise = new Promise((resolve, reject) => {
          resolve(lpTokenContract.methods.decimals().call());
        });
        const totalStakePromise = new Promise((resolve, reject) => {
          resolve(lpTokenContract.methods.balanceOf(gauges[index]).call());
        });
        // const underlyingDecimalsPromise = new Promise((resolve, reject) => {
        //   resolve(lpUnderlyingTokenContract.methods.decimals().call());
        // });

        promises.push(namePromise);
        promises.push(symbolPromise);
        promises.push(decimalsPromise);
        promises.push(totalStakePromise);
        promises.push(decimalsPromise);

        return promises;
      })
      .flat();

    const lpTokens = await Promise.all(lpTokensPromise);

    let projectGauges = [];
    for (let i = 0; i < gauges.length; i++) {
      // let lpPrice = BigNumber(lpTokenUnderlyingInfo[i * 3]).div(10 ** (36-lpTokens[i * 5 + 4])).toNumber();
      // let convRate = BigNumber(lpTokenUnderlyingInfo[i * 3 + 1]).div(10 ** 18).toNumber();
       let lpPrice = BigNumber(1).toNumber();
      let convRate = BigNumber(1).toNumber();
      const gauge = {
        address: gauges[i],
        weight: BigNumber(gaugesWeights[i]).div(1e18).toNumber(),
        currentEpochRelativeWeight: BigNumber(gaugesCurrentEpochRelativeWeights[i]).times(100).div(1e18).toNumber(),
        nextEpochRelativeWeight: BigNumber(gaugesNextEpochRelativeWeights[i]).times(100).div(1e18).toNumber(),
        totalStakeBalance: BigNumber(lpTokens[i * 5 + 3]).div(10 ** lpTokens[i * 5 + 4]).toNumber() * convRate,
        liquidityShare: 0,
        apr: 0,
        lpToken: {
          address: gaugesLPTokens[i],
          name: lpTokens[i * 5],
          symbol: lpTokens[i * 5 + 1],
          decimals: lpTokens[i * 5 + 2],
          underlyingDecimals: lpTokens[i * 5 + 4],
          price: lpPrice,
          conversionRate: convRate
        },
      };

      projectGauges.push(gauge);
    }

    const totalWeight = await gaugeControllerContract.methods.get_total_weight().call();

    const tokenAddress = await gaugeControllerContract.methods.token().call();
    const tokenContract = new web3.eth.Contract(ERC20_ABI, tokenAddress);

    const veTokenAddress = await gaugeControllerContract.methods.voting_escrow().call();
    const veTokenContract = new web3.eth.Contract(ERC20_ABI, veTokenAddress);

    const projectTokenMetadata = {
      address: web3.utils.toChecksumAddress(tokenAddress),
      symbol: await tokenContract.methods.symbol().call(),
      decimals: parseInt(await tokenContract.methods.decimals().call()),
      logo: `/logo128.png`,
    };

    const projectVeTokenMetadata = {
      address: web3.utils.toChecksumAddress(veTokenAddress),
      symbol: await veTokenContract.methods.symbol().call(),
      decimals: parseInt(await veTokenContract.methods.decimals().call()),
      logo: `https://assets.coingecko.com/coins/images/18445/thumb/hnd.PNG`,
    };

    project.totalWeight = BigNumber(totalWeight).div(1e18).toNumber();
    project.tokenMetadata = projectTokenMetadata;
    project.veTokenMetadata = projectVeTokenMetadata;
    project.gauges = projectGauges;
    project.maxPrice = maxPrice

    callback(null, project);
  }

  getProjects = async (payload) => {
    const projects = await this._getProjects();

    this.emitter.emit(PROJECTS_RETURNED, projects);
  };

  _getProjects = async () => {
    // ...
    // get contract where we store projects
    // get project info
    // store them into the storage

    // for now just return stored projects
    return this.getStore('projects');
  };

  getProject = async (payload) => {

    const configured = this.getStore('configured')
    if(!configured) {
      return;
    }

    const web3 = await stores.accountStore.getWeb3Provider();
    if (!web3) {
      return null;
    }

    const projects = await this._getProjects();

    let project = projects.filter((project) => {
      return project.id === payload.content.id;
    });

    if (project.length > 0) {
      project = project[0];
    }

    this.emitter.emit(PROJECT_RETURNED, project);
  };

  getTokenBalances = async (payload) => {
    const configured = this.getStore('configured')
    if(!configured) {
      return;
    }

    const web3 = await stores.accountStore.getWeb3Provider();
    if (!web3) {
      return null;
    }

    const account = stores.accountStore.getStore('account');
    if (!account || !account.address) {
      return null;
    }

    const projects = await this._getProjects();

    let project = projects.filter((project) => {
      return project.id === payload.content.id;
    });

    if (project.length > 0) {
      project = project[0];
    }

    const tokenContract = new web3.eth.Contract(ERC20_ABI, project.tokenMetadata.address);
    const tokenBalance = await tokenContract.methods.balanceOf(account.address).call();
    const allowance = await tokenContract.methods.allowance(account.address, project.veTokenMetadata.address).call();
    const totalLocked = await tokenContract.methods.balanceOf(project.veTokenMetadata.address).call();

    const veTokenContract = new web3.eth.Contract(VOTING_ESCROW_ABI, project.veTokenMetadata.address);
    const veTokenBalance = await veTokenContract.methods.balanceOf(account.address).call();
    const totalVeTokenSupply = await veTokenContract.methods.totalSupply().call();
    const userLocked = await veTokenContract.methods.locked(account.address).call();
    const supply = await veTokenContract.methods.supply().call();


    project.tokenMetadata.balance = BigNumber(tokenBalance)
      .div(10 ** project.tokenMetadata.decimals)
      .toFixed(project.tokenMetadata.decimals);
    project.tokenMetadata.allowance = BigNumber(allowance)
      .div(10 ** project.tokenMetadata.decimals)
      .toFixed(project.tokenMetadata.decimals);
    project.tokenMetadata.totalLocked = BigNumber(totalLocked)
      .div(10 ** project.tokenMetadata.decimals)
      .toFixed(project.tokenMetadata.decimals);

    project.veTokenMetadata.balance = BigNumber(veTokenBalance)
      .div(10 ** project.veTokenMetadata.decimals)
      .toFixed(project.veTokenMetadata.decimals);
    project.veTokenMetadata.totalSupply = BigNumber(totalVeTokenSupply)
      .div(10 ** project.veTokenMetadata.decimals)
      .toFixed(project.veTokenMetadata.decimals);
    project.veTokenMetadata.userLocked = BigNumber(userLocked.amount)
      .div(10 ** project.veTokenMetadata.decimals)
      .toFixed(project.veTokenMetadata.decimals);

    project.veTokenMetadata.supply = BigNumber(supply)
      .div(10 ** project.tokenMetadata.decimals)
      .toFixed(project.tokenMetadata.decimals);

    project.veTokenMetadata.userLockEnd = userLocked.end;

    let gaugeControllerContract = null
    let voteWeights = []

    // get the gauge vote weights for the user
    gaugeControllerContract = new web3.eth.Contract(GAUGE_CONTROLLER_ABI, project.gaugeProxyAddress);

    const gaugesVoteWeightsPromise = project.gauges.map((gauge) => {
      return new Promise((resolve, reject) => {
        resolve(gaugeControllerContract.methods.vote_user_slopes(account.address, gauge.address).call());
      });
    });

    voteWeights = await Promise.all(gaugesVoteWeightsPromise);
    voteWeights = voteWeights.map((weight) => {
      return weight.power
    })

    // get the balanceOf for the user
    const balanceOfPromise = project.gauges.map((gauge) => {
      return new Promise((resolve, reject) => {
        const erc20Contract = new web3.eth.Contract(ERC20_ABI, gauge.address);
        resolve(erc20Contract.methods.balanceOf(account.address).call());
      });
    });

    const balanceOf = await Promise.all(balanceOfPromise);

    const workingBalanceOfPromise = project.gauges.map((gauge) => {
      return new Promise((resolve, reject) => {
        const gaugeContract = new web3.eth.Contract(GAUGE_ABI, gauge.address);
        resolve(gaugeContract.methods.working_balances(account.address).call());
      });
    });

    const workingBalanceOf = await Promise.all(workingBalanceOfPromise);

    const lastUserVotesPromise = project.gauges.map((gauge) => {
      return new Promise((resolve, reject) => {
        const gaugeContract = new web3.eth.Contract(GAUGE_CONTROLLER_ABI, project.gaugeProxyAddress);
        resolve(gaugeContract.methods.last_user_vote(account.address, gauge.address).call());
      });
    });

    const lastUserVotes = await Promise.all(lastUserVotesPromise);

    const rewardPolicyMakerContract = new web3.eth.Contract(REWARD_POLICY_MAKER_ABI, project.rewardPolicyMaker);
    const currentRewardRate = await rewardPolicyMakerContract.methods.rate_at(currentEpochTime()).call();
    const nextEpochRewardRate = await rewardPolicyMakerContract.methods.rate_at(nextEpochTime()).call();

    let totalPercentUsed = 0

    for (let i = 0; i < project.gauges.length; i++) {

      project.gauges[i].balance = BigNumber(balanceOf[i]).div(10 ** project.gauges[i].lpToken.underlyingDecimals).toNumber() * project.gauges[i].lpToken.conversionRate

      project.gauges[i].workingBalance = BigNumber(workingBalanceOf[i])
      project.gauges[i].rawBalance = BigNumber(balanceOf[i])

      const gaugeVotePercent = BigNumber(voteWeights[i]).div(100)
      project.gauges[i].userVotesPercent = gaugeVotePercent.toFixed(2)
      totalPercentUsed = BigNumber(totalPercentUsed).plus(gaugeVotePercent)

      project.gauges[i].liquidityShare = userAppliedLiquidityShare(project.gauges[i], veTokenBalance, totalVeTokenSupply);
      project.gauges[i].boost = userBoost(project.gauges[i], veTokenBalance, totalVeTokenSupply);
      project.gauges[i].appliedBoost = userAppliedBoost(project.gauges[i]);
      project.gauges[i].needVeHndForMaxBoost =
        (project.gauges[i].balance * project.veTokenMetadata.totalSupply
          / (project.gauges[i].totalStakeBalance - project.gauges[i].balance)
        ) - project.veTokenMetadata.balance;

      let providedLiquidity = project.gauges[i].balance * project.gauges[i].lpToken.price;
      let totalProvidedLiquidity = project.gauges[i].totalStakeBalance * project.gauges[i].lpToken.price;

      let totalRewards = currentRewardRate * 365 * 24 * 3600 * project.maxPrice / 1e18;
      let gaugeRewards = totalRewards * project.gauges[i].currentEpochRelativeWeight / 100
      let rewards = gaugeRewards * project.gauges[i].liquidityShare / 100

      let nextEpochTotalRewards = nextEpochRewardRate * 365 * 24 * 3600 * project.maxPrice / 1e18;
      let nextEpochGaugeRewards = nextEpochTotalRewards * project.gauges[i].nextEpochRelativeWeight / 100;
      let nextEpochRewards = nextEpochGaugeRewards * project.gauges[i].liquidityShare / 100

      if (providedLiquidity > 0) {
        project.gauges[i].apr = rewards * 100 / providedLiquidity
        project.gauges[i].nextEpochApr = nextEpochRewards * 100 / providedLiquidity
      }

      project.gauges[i].gaugeApr = gaugeRewards * 100 / totalProvidedLiquidity
      project.gauges[i].nextEpochGaugeApr = nextEpochGaugeRewards * 100 / totalProvidedLiquidity

      project.gauges[i].nextVoteTimestamp = +lastUserVotes[i] === 0 ? 0 : +lastUserVotes[i] + 10 * 86400
    }

    project.userVotesPercent = totalPercentUsed.toFixed(2)

    let newProjects = projects.map((proj) => {
      if (proj.id === project.id) {
        return project;
      }

      return proj;
    });

    this.setStore({ projects: newProjects });

    this.emitter.emit(TOKEN_BALANCES_RETURNED, project);
  };

  approveLock = async (payload) => {
    const account = stores.accountStore.getStore('account');
    if (!account) {
      return false;
      //maybe throw an error
    }

    const web3 = await stores.accountStore.getWeb3Provider();
    if (!web3) {
      return false;
      //maybe throw an error
    }

    const { amount, project } = payload.content;

    this._callApproveLock(web3, project, account, amount, (err, approveResult) => {
      if (err) {
        return this.emitter.emit(ERROR, err);
      }

      return this.emitter.emit(APPROVE_LOCK_RETURNED, approveResult);
    });
  };

  _callApproveLock = async (web3, project, account, amount, callback) => {
    const tokenContract = new web3.eth.Contract(ERC20_ABI, project.tokenMetadata.address);

    let amountToSend = '0';
    if (amount === 'max') {
      amountToSend = MAX_UINT256;
    } else {
      amountToSend = BigNumber(amount)
        .times(10 ** project.tokenMetadata.decimals)
        .toFixed(0);
    }

    await this._asyncCallContractWait(web3, tokenContract, 'approve', [project.veTokenMetadata.address, amountToSend], account, null, GET_TOKEN_BALANCES, { id: project.id }, callback);
  };

  lock = async (payload) => {
    const account = stores.accountStore.getStore('account');
    if (!account) {
      return false;
      //maybe throw an error
    }

    const web3 = await stores.accountStore.getWeb3Provider();
    if (!web3) {
      return false;
      //maybe throw an error
    }

    const { amount, selectedDate, project } = payload.content;

    this._callLock(web3, project, account, amount, selectedDate, (err, lockResult) => {
      if (err) {
        return this.emitter.emit(ERROR, err);
      }

      return this.emitter.emit(LOCK_RETURNED, lockResult);
    });
  };

  unlock = async (payload) => {
    const account = stores.accountStore.getStore('account');
    if (!account) {
      return false;
      //maybe throw an error
    }

    const web3 = await stores.accountStore.getWeb3Provider();
    if (!web3) {
      return false;
      //maybe throw an error
    }

    const { project } = payload.content;

    this._callUnlock(web3, project, account, (err, lockResult) => {
      if (err) {
        return this.emitter.emit(ERROR, err);
      }

      return this.emitter.emit(WITHDRAW_RETURNED, lockResult);
    });
  };

  _callLock = async (web3, project, account, amount, selectedDate, callback) => {
    const escrowContract = new web3.eth.Contract(VOTING_ESCROW_ABI, project.veTokenMetadata.address);

    const amountToSend = BigNumber(amount)
      .times(10 ** project.tokenMetadata.decimals)
      .toFixed(0);

    await this._asyncCallContractWait(web3, escrowContract, 'create_lock', [amountToSend, selectedDate], account, null, GET_TOKEN_BALANCES, { id: project.id }, callback);
  };

  _callUnlock = async (web3, project, account, callback) => {
    const escrowContract = new web3.eth.Contract(VOTING_ESCROW_ABI, project.veTokenMetadata.address);

    await this._asyncCallContractWait(web3, escrowContract, 'withdraw', [], account, null, GET_TOKEN_BALANCES, { id: project.id }, callback);
  };

  vote = async (payload) => {
    const account = stores.accountStore.getStore('account');
    if (!account) {
      return false;
      //maybe throw an error
    }

    const web3 = await stores.accountStore.getWeb3Provider();
    if (!web3) {
      return false;
      //maybe throw an error
    }

    const { amount, gaugeAddress, project } = payload.content;

    this._calVoteForGaugeWeights(web3, project, account, amount, gaugeAddress, (err, voteResult) => {
      if (err) {
        return this.emitter.emit(ERROR, err);
      }

      return this.emitter.emit(VOTE_RETURNED, voteResult);
    });
  };

  _calVoteForGaugeWeights = async (web3, project, account, amount, gaugeAddress, callback) => {
    const gaugeControllerContract = new web3.eth.Contract(GAUGE_CONTROLLER_ABI, project.gaugeProxyAddress);

    const amountToSend = BigNumber(amount)
      .times(100)
      .toFixed(0);


    console.log(gaugeControllerContract)
    console.log('vote_for_gauge_weights')
    console.log([gaugeAddress, amountToSend])

    await this._asyncCallContractWait(web3, gaugeControllerContract, 'vote_for_gauge_weights', [gaugeAddress, amountToSend], account, null, GET_TOKEN_BALANCES, { id: project.id }, callback);
  };

  increaseLockAmount = async (payload) => {
    const account = stores.accountStore.getStore('account');
    if (!account) {
      return false;
      //maybe throw an error
    }

    const web3 = await stores.accountStore.getWeb3Provider();
    if (!web3) {
      return false;
      //maybe throw an error
    }

    const { amount, project } = payload.content;

    this._callIncreaseAmount(web3, project, account, amount, (err, lockResult) => {
      if (err) {
        return this.emitter.emit(ERROR, err);
      }

      return this.emitter.emit(INCREASE_LOCK_AMOUNT_RETURNED, lockResult);
    });
  };

  _callIncreaseAmount = async (web3, project, account, amount, callback) => {
    const escrowContract = new web3.eth.Contract(VOTING_ESCROW_ABI, project.veTokenMetadata.address);

    const amountToSend = BigNumber(amount)
      .times(10 ** project.tokenMetadata.decimals)
      .toFixed(0);


    await this._asyncCallContractWait(web3, escrowContract, 'increase_amount', [amountToSend], account, null, GET_TOKEN_BALANCES, { id: project.id }, callback);
  };

  increaseLockDuration = async (payload) => {
    const account = stores.accountStore.getStore('account');
    if (!account) {
      return false;
      //maybe throw an error
    }

    const web3 = await stores.accountStore.getWeb3Provider();
    if (!web3) {
      return false;
      //maybe throw an error
    }

    let { selectedDate, project } = payload.content;

    // if (project.useDays) {
    //   selectedDate = moment.duration(moment.unix(selectedDate).diff(moment().startOf('day'))).asDays();
    // }

    this._callIncreaseUnlockTime(web3, project, account, selectedDate, (err, lockResult) => {
      if (err) {
        return this.emitter.emit(ERROR, err);
      }

      return this.emitter.emit(INCREASE_LOCK_DURATION_RETURNED, lockResult);
    });
  };

  applyBoost = async (payload) => {

    const account = stores.accountStore.getStore('account');
    if (!account) {
      return false;
      //maybe throw an error
    }

    const web3 = await stores.accountStore.getWeb3Provider();
    if (!web3) {
      return false;
      //maybe throw an error
    }

    let { gaugeAddress, project } = payload.content;

    const gaugeContract = new web3.eth.Contract(GAUGE_ABI, gaugeAddress);
    await this._asyncCallContractWait(
      web3, gaugeContract, 'user_checkpoint', [account.address], account, null,
      GET_TOKEN_BALANCES, { id: project.id }, (err, result) => {
        if (err) {
          return this.emitter.emit(ERROR, err);
        }
        return this.emitter.emit(APPLY_BOOST_RETURNED, result);
      });

  }

  _callIncreaseUnlockTime = async (web3, project, account, selectedDate, callback) => {
    const escrowContract = new web3.eth.Contract(VOTING_ESCROW_ABI, project.veTokenMetadata.address);

    await this._asyncCallContractWait(web3, escrowContract, 'increase_unlock_time', [selectedDate], account, null, WITHDRAW_RETURNED, { id: project.id }, callback);
  };

  _asyncCallContractWait = async(web3, contract, method, params, account, gasPrice, dispatchEvent, dispatchEventPayload, callback) => {
    let sendPayload = {
      from: account.address
    }

    this._callContractWait(web3, contract, method, params, account, sendPayload, dispatchEvent, dispatchEventPayload, callback);
  }

  _callContractWait = (web3, contract, method, params, account, sendPayload, dispatchEvent, dispatchEventPayload, callback) => {
    const context = this;

    contract.methods[method](...params)
      .send(sendPayload)
      .on('transactionHash', function (hash) {
        context.emitter.emit(TX_SUBMITTED, hash);
      })
      .on('receipt', function (receipt) {
        console.log(receipt)
        callback(null, receipt.transactionHash);

        if (dispatchEvent) {
          console.log('dispatching new event')
          console.log(dispatchEvent)
          console.log(dispatchEventPayload)
          context.dispatcher.dispatch({ type: dispatchEvent, content: dispatchEventPayload });
        }
      })
      .on('error', function (error) {
        if (!error.toString().includes('-32601')) {
          if (error.message) {
            return callback(error.message);
          }
          callback(error);
        }
      })
      .catch((error) => {
        if (!error.toString().includes('-32601')) {
          if (error.message) {
            return callback(error.message);
          }
          callback(error);
        }
      });
  };

  _getMaxPrice = async () => {
    try {
      const web3 = await stores.accountStore.getWeb3Provider();
      if (!web3) {
        return;
      }
      const busdMaxLpContract = new web3.eth.Contract(LP_ABI, "0x88137f2a610693e975b17d7cf940bf014cf0f325");
      const reserves = await busdMaxLpContract.methods.getReserves().call();
      const busd = BigNumber(reserves["_reserve0"])
      const max = BigNumber(reserves["_reserve1"])
      const busdPerMax = busd.div(max);
      return busdPerMax;
    }
    catch(err){
      console.log(err)
    }
    return 0;
  };
}

function userLiquidityShare(gauge, veTokenBalance, totalVeTokenSupply) {
  return Math.min(
    BigNumber(gauge.balance).multipliedBy(0.4)
      .plus(
        BigNumber(gauge.totalStakeBalance)
          .multipliedBy(0.6)
          .multipliedBy(BigNumber(veTokenBalance))
          .div(BigNumber(totalVeTokenSupply))
      ).toNumber(),
    gauge.balance
  ) * 100 / gauge.totalStakeBalance;
}

function userBoost(gauge, veTokenBalance, totalVeTokenSupply) {
  return Math.min(userLiquidityShare(gauge, veTokenBalance, totalVeTokenSupply) /
    userLiquidityShare(gauge, 0, totalVeTokenSupply), 2.5)
}

function userAppliedBoost(gauge) {
  return BigNumber(gauge.workingBalance).div(BigNumber(gauge.rawBalance).multipliedBy(0.4)).toNumber()
}

function userAppliedLiquidityShare(gauge) {
  return gauge.balance * 0.4 * userAppliedBoost(gauge) * 100 / gauge.totalStakeBalance;
}

export default Store;

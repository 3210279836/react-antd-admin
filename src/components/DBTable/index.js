import React from 'react';
import {message, notification, Icon} from 'antd';
import Error from '../Error';
import InnerForm from './InnerForm.js';
import InnerTable from './InnerTable.js';
import InnerPagination from './InnerPagination.js';
import './index.less';
import globalConfig from 'config.js';
import ajax from 'superagent';

/**
 * 操作数据库中的一张表的组件, 又可以分为3个组件: 表单+表格+分页器
 */
class DBTable extends React.Component {

  constructor(props) {
    super(props);
    // 这必须是个同步操作
    this.tryFetchSchema();
  }

  // 单向数据流的情况下, 父组件要保存子组件的所有状态...非常蛋疼...
  // 破坏了子组件的"封闭"原则

  state = {
    // 表单组件的状态
    queryObj: {},  // 表单中的查询条件

    // 表格组件的状态
    data: [],  // 表格中显示的数据
    tableLoading: false,  // 表格是否是loading状态
    selectedRowKeys: [],  // 当前有哪些行被选中, 这里只保存key
    selectedRows: [],  // 当前有哪些行被选中, 保存完整数据

    // 分页器的状态
    currentPage: 1,  // 当前第几页
    pageSize: 50,  // pageSize暂时不可修改, 固定50
    total: 0,  // 总共有多少条数据
  }

  /**
   * 刚进入页面时触发一次查询
   */
  componentDidMount() {
    this.setState({tableLoading: true});
    this.select(this.state.queryObj, 1, this.state.pageSize).then((result) => {
      //message.success('查询成功');
      this.setState({currentPage: 1, data: result.data, total: result.totalCount, tableLoading: false});
    }, this.handleError);
  }

  /**
   * 尝试获取某个表的querySchema和dataSchema
   * 无论是从远端获取还是从本地配置读取, 这个方法必须是同步的
   *
   * @param dbName
   * @param tableName
   */
  tryFetchSchema() {
    const routes = this.props.routes;
    // 这个tableName是路由表配置中传过来的
    // 可以用这个方法向组件传值
    const tableName = routes.pop().tableName;
    if (tableName) {
      console.log(`init component DBTable with tableName = ${tableName}`);
    } else {
      console.error('can not find tableName, check your router config');
      this.inited = false;  // 是否成功获取schema
      this.errorMsg = '找不到表名, 请检查路由配置';  // 如果没能成功获取schema, 错误信息是什么?
      return;
    }

    this.tableName = tableName;

    // 尝试加载querySchema
    try {
      this.querySchema = require(`../../schema/${tableName}.querySchema.js`);
    } catch (e) {
      console.error(e);
      this.inited = false;
      this.errorMsg = `加载${tableName}表的querySchema出错, 请检查配置`;
      return;
    }

    // 尝试加载dataSchema
    try {
      this.dataSchema = require(`../../schema/${tableName}.dataSchema.js`);
    } catch (e) {
      console.error(e);
      this.inited = false;
      this.errorMsg = `加载${tableName}表的dataSchema出错, 请检查配置`;
      return;
    }

    // 尝试加载个性化配置, 加载失败也没影响
    try {
      this.tableConfig = require(`../../schema/${tableName}.config.js`);
    } catch (e) {
      console.warn(`未找到${tableName}表个性化配置, 将使用默认配置`);
      // 默认配置写在这里
      this.tableConfig = {
        showExport: true,  // 显示导出按钮, 默认true
        showImport: true,  // 显示导入按钮, 默认true
      }
    }

    this.inited = true;
  }

  /**
   * 切换分页时触发查询
   *
   * @param page
   */
  handlePageChange = (page) => {
    this.setState({tableLoading: true});
    this.select(this.state.queryObj, page, this.state.pageSize).then((result) => {
      //message.success('查询成功');
      this.setState({
        currentPage: page,
        data: result.data,
        total: result.totalCount,
        tableLoading: false,
        selectedRowKeys: [],
        selectedRows: [],
      });
    }, this.handleError);
  }

  /**
   * 点击提交按钮时触发查询
   *
   * @param queryObj
   */
  handleFormSubmit = (queryObj) => {
    this.setState({tableLoading: true});
    // 这时查询条件已经变了, 要从第一页开始查
    this.select(queryObj, 1, this.state.pageSize).then((result) => {
      //message.success('查询成功');
      this.setState({
        currentPage: 1,
        data: result.data,
        total: result.totalCount,
        tableLoading: false,
        queryObj: queryObj,
        selectedRowKeys: [],
        selectedRows: [],
      });
    }, this.handleError);
  }

  /**
   * 处理表格的选择事件
   *
   * @param selectedRowKeys
   * @param selectedRows
   */
  handleSelectChange = (selectedRowKeys, selectedRows) => {
    this.setState({selectedRowKeys, selectedRows});
  }

  /**
   * 统一处理ajax失败时的回调
   *
   * @param errorMsg
   */
  handleError = (errorMsg) => {
    // 对于错误信息, 要很明显的提示用户, 这个通知框要用户手动关闭
    notification.error({
      message: '出错啦!',
      description: errorMsg,
      duration: 0,
    });
    this.setState({tableLoading: false});
  };

  /**
   * 按当前的查询条件重新查询一次
   */
  refresh = () => {
    this.setState({tableLoading: true});
    this.select(this.state.queryObj, this.state.currentPage, this.state.pageSize).then((result) => {
      //message.success('查询成功');
      this.setState({
        data: result.data,
        total: result.totalCount,
        tableLoading: false,
        selectedRowKeys: [],
        selectedRows: [],
      });
    }, this.handleError);
  }

  /**
   * 向服务端发送select请求, 会返回一个promise对象
   *
   * @param queryObj 包含了form中所有的查询条件, 再加上page和pageSize, 后端就能拼成完整的sql
   * @param page
   * @param pageSize
   * @returns {Promise}
   */
  select(queryObj, page, pageSize) {
    const hide = message.loading('正在查询...', 0);
    // superagent请求会直接返回一个promise对象, 但不能直接用, 还是要包装一层
    const tmpObj = Object.assign({}, queryObj);  // 创建一个新的临时对象, 其实直接修改queryObj也可以
    tmpObj.page = page;
    tmpObj.pageSize = pageSize;
    const url = `${globalConfig.apiHost}/${globalConfig.apiPath}/${this.tableName}/select`;  // 拼接要请求的url地址
    //console.log(`querying ${url}`);

    const promise = new Promise((resolve, reject) => {
      ajax.post(url).send(tmpObj).end((err, res) => {
        hide();
        // err就是一个字符串
        // res是一个Response对象, 其中的body字段才是服务端真正返回的数据
        if (err || !res.body.success) {
          reject(err ? '请求select接口出错, 请联系管理员' : res.body.errorMsg);
        } else {
          resolve(res.body);
        }
      });
    });

    return promise;
  }

  render() {
    // 如果没能成功加载schema, 显示错误信息
    if (!this.inited) {
      return (
        <Error errorMsg={this.errorMsg}/>
      );
    }

    // 之前是直接{...this.state}, 感觉会影响效率
    // 父组件中的方法都是handleXXX, 子组件中都是onXXX
    return (
      <div>
        <InnerForm onSubmit={this.handleFormSubmit} schema={this.querySchema} tableConfig={this.tableConfig}/>
        <InnerTable data={this.state.data} tableLoading={this.state.tableLoading}
                    selectedRowKeys={this.state.selectedRowKeys}
                    selectedRows={this.state.selectedRows} schema={this.dataSchema} refresh={this.refresh}
                    onSelectChange={this.handleSelectChange} tableConfig={this.tableConfig}/>
        <InnerPagination currentPage={this.state.currentPage} total={this.state.total} pageSize={this.state.pageSize}
                         onChange={this.handlePageChange} tableConfig={this.tableConfig}/>
      </div>
    );
  }

}

export default DBTable;

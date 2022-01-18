/*
import { Queue } from '@src/classes';
import { describe, beforeEach, it } from 'mocha';
import { expect, assert } from 'chai';
import * as IORedis from 'ioredis';
import { v4 } from 'uuid';
import { Worker } from '@src/classes/worker';
import { after } from 'lodash';
import { QueueEvents } from '@src/classes/queue-events';
import { QueueScheduler } from '@src/classes/queue-scheduler';

describe('Queue', function() {
  let queue: Queue;
  let queueName: string;
  let queueEvents: QueueEvents;

  beforeEach(function() {
    client = new IORedis();
  });

  beforeEach(async function() {
    queueName = 'test-' + v4();
    queue = new Queue(queueName);
    queueEvents = new QueueEvents(queueName);
    await queueEvents.init();
  });

  afterEach(async function() {
    await queue.close();
    await queueEvents.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  it('creates a queue with default job options', () => {
    const defaultJobOptions = { removeOnComplete: true };
    const queue = new Queue('custom', {
      defaultJobOptions,
    });

    expect(queue.defaultJobOptions).to.be.eql(defaultJobOptions);
  });

  describe('bulk jobs', () => {
    it('should default name of job', () => {
      const queue = new Queue('custom');

      return queue.addBulk([{ name: 'specified' }, {}]).then(jobs => {
        expect(jobs).to.have.length(2);

        expect(jobs[0].name).to.equal('specified');
        expect(jobs[1].name).to.equal('__default__');
      });
    });

    it('should default options from queue', () => {
      const queue = new Queue('custom', {
        defaultJobOptions: {
          removeOnComplete: true,
        },
      });

      return queue.addBulk([{}]).then(jobs => {
        expect(jobs[0].opts.removeOnComplete).to.equal(true);
      });
    });
  });
});
*/

import { expect } from 'chai';
import * as IORedis from 'ioredis';
import { describe, beforeEach, it } from 'mocha';
import * as sinon from 'sinon';
import { v4 } from 'uuid';
import { FlowProducer, Queue, QueueScheduler } from '../src/classes';
import { removeAllQueueData } from '../src/utils';

describe('queues', function () {
  const sandbox = sinon.createSandbox();

  let queue: Queue;
  let queueName: string;

  const connection = { host: 'localhost' };

  beforeEach(async function () {
    queueName = `test-${v4()}`;
    queue = new Queue(queueName, { connection });
    await queue.waitUntilReady();
  });

  afterEach(async function () {
    sandbox.restore();
    await queue.close();
    await removeAllQueueData(new IORedis(), queueName);
  });

  describe('.drain', () => {
    it('count added, unprocessed jobs', async () => {
      const maxJobs = 100;
      const added = [];

      for (let i = 1; i <= maxJobs; i++) {
        added.push(queue.add('test', { foo: 'bar', num: i }));
      }

      await Promise.all(added);
      const count = await queue.count();
      expect(count).to.be.eql(maxJobs);
      await queue.drain();
      const countAfterEmpty = await queue.count();
      expect(countAfterEmpty).to.be.eql(0);
    });

    describe('when having a flow', async () => {
      describe('when parent belongs to same queue', async () => {
        describe('when parent has more than 1 pending children', async () => {
          it('moves parent record to failed', async () => {
            await queue.waitUntilReady();
            const name = 'child-job';

            const flow = new FlowProducer({ connection });
            await flow.add({
              name: 'parent-job',
              queueName,
              data: {},
              children: [
                { name, data: { idx: 0, foo: 'bar' }, queueName },
                { name, data: { idx: 1, foo: 'baz' }, queueName },
                { name, data: { idx: 2, foo: 'qux' }, queueName },
              ],
            });

            const count = await queue.count();
            expect(count).to.be.eql(4);

            await queue.drain();

            const client = await queue.client;
            const keys = await client.keys(`bull:${queue.name}:*`);

            expect(keys.length).to.be.eql(4);

            const countAfterEmpty = await queue.count();
            expect(countAfterEmpty).to.be.eql(0);

            const failedCount = await queue.getJobCountByTypes('failed');
            expect(failedCount).to.be.eql(1);
          });
        });

        describe('when parent has only 1 pending children', async () => {
          it('deletes parent record', async () => {
            await queue.waitUntilReady();
            const name = 'child-job';

            const flow = new FlowProducer({ connection });
            await flow.add({
              name: 'parent-job',
              queueName,
              data: {},
              children: [{ name, data: { idx: 0, foo: 'bar' }, queueName }],
            });

            const count = await queue.count();
            expect(count).to.be.eql(2);

            await queue.drain();

            const client = await queue.client;
            const keys = await client.keys(`bull:${queue.name}:*`);

            expect(keys.length).to.be.eql(3);

            const countAfterEmpty = await queue.count();
            expect(countAfterEmpty).to.be.eql(0);

            const failedCount = await queue.getJobCountByTypes('failed');
            expect(failedCount).to.be.eql(0);
          });
        });
      });

      describe('when parent belongs to different queue', async () => {
        describe('when parent has more than 1 pending children', async () => {
          it('deletes each children until trying to move parent to wait', async () => {
            await queue.waitUntilReady();
            const parentQueueName = `test-${v4()}`;
            const parentQueue = new Queue(parentQueueName, { connection });
            await parentQueue.waitUntilReady();
            const name = 'child-job';

            const flow = new FlowProducer({ connection });
            await flow.add({
              name: 'parent-job',
              queueName: parentQueueName,
              data: {},
              children: [
                { name, data: { idx: 0, foo: 'bar' }, queueName },
                { name, data: { idx: 1, foo: 'baz' }, queueName },
                { name, data: { idx: 2, foo: 'qux' }, queueName },
              ],
            });

            const count = await queue.count();
            expect(count).to.be.eql(3);

            await queue.drain();

            const client = await queue.client;
            const keys = await client.keys(`bull:${queue.name}:*`);

            expect(keys.length).to.be.eql(3);

            const countAfterEmpty = await queue.count();
            expect(countAfterEmpty).to.be.eql(0);

            const childrenFailedCount = await queue.getJobCountByTypes(
              'failed',
            );
            expect(childrenFailedCount).to.be.eql(0);

            const parentWaitCount = await parentQueue.getJobCountByTypes(
              'wait',
            );
            expect(parentWaitCount).to.be.eql(1);
            await parentQueue.close();
            await removeAllQueueData(new IORedis(), parentQueueName);
          });
        });

        describe('when parent has only 1 pending children', async () => {
          it('moves parent to wait to try to process it', async () => {
            await queue.waitUntilReady();
            const parentQueueName = `test-${v4()}`;
            const parentQueue = new Queue(parentQueueName, { connection });
            await parentQueue.waitUntilReady();
            const name = 'child-job';

            const flow = new FlowProducer({ connection });
            await flow.add({
              name: 'parent-job',
              queueName: parentQueueName,
              data: {},
              children: [{ name, data: { idx: 0, foo: 'bar' }, queueName }],
            });

            const count = await queue.count();
            expect(count).to.be.eql(1);

            await queue.drain();

            const client = await queue.client;
            const keys = await client.keys(`bull:${queue.name}:*`);

            expect(keys.length).to.be.eql(3);

            const countAfterEmpty = await queue.count();
            expect(countAfterEmpty).to.be.eql(0);

            const failedCount = await queue.getJobCountByTypes('failed');
            expect(failedCount).to.be.eql(0);

            const parentWaitCount = await parentQueue.getJobCountByTypes(
              'wait',
            );
            expect(parentWaitCount).to.be.eql(1);
            await parentQueue.close();
            await removeAllQueueData(new IORedis(), parentQueueName);
          });
        });
      });
    });

    describe('when delayed option is provided as false', () => {
      it('clean queue without delayed jobs', async () => {
        const maxJobs = 50;
        const maxDelayedJobs = 50;
        const added = [];
        const delayed = [];

        const queueScheduler = new QueueScheduler(queueName, { connection });
        await queueScheduler.waitUntilReady();

        for (let i = 1; i <= maxJobs; i++) {
          added.push(queue.add('test', { foo: 'bar', num: i }));
        }

        for (let i = 1; i <= maxDelayedJobs; i++) {
          delayed.push(
            queue.add('test', { foo: 'bar', num: i }, { delay: 10000 }),
          );
        }

        await Promise.all(added);
        await Promise.all(delayed);
        const count = await queue.count();
        expect(count).to.be.eql(maxJobs + maxDelayedJobs);
        await queue.drain(false);
        const countAfterEmpty = await queue.count();
        expect(countAfterEmpty).to.be.eql(50);
        await queueScheduler.close();
      });
    });

    describe('when delayed option is provided as true', () => {
      it('clean queue including delayed jobs', async () => {
        const maxJobs = 50;
        const maxDelayedJobs = 50;
        const added = [];
        const delayed = [];

        const queueScheduler = new QueueScheduler(queueName, { connection });
        await queueScheduler.waitUntilReady();

        for (let i = 1; i <= maxJobs; i++) {
          added.push(queue.add('test', { foo: 'bar', num: i }));
        }

        for (let i = 1; i <= maxDelayedJobs; i++) {
          delayed.push(
            queue.add('test', { foo: 'bar', num: i }, { delay: 10000 }),
          );
        }

        await Promise.all(added);
        await Promise.all(delayed);
        const count = await queue.count();
        expect(count).to.be.eql(maxJobs + maxDelayedJobs);
        await queue.drain(true);
        const countAfterEmpty = await queue.count();
        expect(countAfterEmpty).to.be.eql(0);
        await queueScheduler.close();
      });
    });

    describe('when queue is paused', () => {
      it('clean queue including paused jobs', async () => {
        const maxJobs = 50;
        const added = [];

        await queue.pause();
        for (let i = 1; i <= maxJobs; i++) {
          added.push(queue.add('test', { foo: 'bar', num: i }));
        }

        await Promise.all(added);
        const count = await queue.count();
        expect(count).to.be.eql(maxJobs);
        const count2 = await queue.getJobCounts('paused');
        expect(count2.paused).to.be.eql(maxJobs);
        await queue.drain();
        const countAfterEmpty = await queue.count();
        expect(countAfterEmpty).to.be.eql(0);
      });
    });
  });
});
